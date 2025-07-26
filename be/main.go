package main

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/disintegration/imaging"
	"github.com/gorilla/mux"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type Document struct {
	ID          string          `json:"id"`
	Title       string          `json:"title"`
	Content     string          `json:"content,omitempty"`
	Path        string          `json:"path,omitempty"`
	Children    []ShortDocument `json:"children,omitempty"`
	Modified    time.Time       `json:"modified"`
	Uncommitted bool            `json:"uncommitted"`
	Favorite    bool            `json:"favorite"`
}

type ShortDocument struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	HasChildren bool   `json:"hasChildren"`
	Path        string `json:"path,omitempty"`
}

func documentToShort(in *Document) *ShortDocument {
	return &ShortDocument{
		ID:          in.ID,
		Title:       in.Title,
		HasChildren: len(in.Children) > 0,
		Path:        in.Path,
	}
}

type SearchResults struct {
	Results     []Document `json:"results"`
	Total       int        `json:"total"`
	CurrentPage int        `json:"currentPage"`
	TotalPages  int        `json:"totalPages"`
	PageSize    int        `json:"pageSize"`
}

type Storage interface {
	GetRootDocuments() ([]ShortDocument, error)
	GetRelatedDocuments(path string) (map[string][]ShortDocument, error)
	GetDocument(path string) (Document, error)
	GetChildDocuments(parentPath string) ([]ShortDocument, error)
	CreateDocument(parentPath, title, content string) (Document, error)
	UpdateDocument(path, title, content string, commitChanges bool) (Document, error)
	DeleteDocument(path string) error
	MoveDocument(sourcePath, targetPath string) error
}

type SearchIndex interface {
	IndexDocument(doc Document) error
	DeleteDocument(docPath string) error
}

//go:embed static/*
var staticFiles embed.FS

func main() {
	// Создаем канал для перехвата сигналов
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	storage, err := NewGitStorage("data")
	if err != nil {
		log.Fatal(err)
	}

	draftStorage, err := NewDraftStorage("data")
	if err != nil {
		log.Fatal(err)
	}

	md, err := NewMetadata("data", 60)
	if err != nil {
		log.Fatal(err)
	}
	defer md.Stop()

	// Initialize search engine
	searchEngine := NewSearchEngine([]string{"english", "russian"})
	if err := searchEngine.LoadFromStorage(storage); err != nil {
		log.Printf("Warning: Failed to initialize search index: %v", err)
	}

	// Create handlers
	documentHandler := NewDocumentHandler(storage, searchEngine, md, draftStorage)
	searchHandler := NewSearchHandler(searchEngine)

	r := mux.NewRouter()

	// API routes
	apiRouter := r.PathPrefix("/api").Subrouter()
	{
		// Document routes
		apiRouter.HandleFunc("/documents", documentHandler.GetRootDocuments).Methods("GET")
		apiRouter.HandleFunc("/documents/{rest:.*}", documentHandler.GetChildDocuments).Methods("GET")
		apiRouter.HandleFunc("/document/{rest:.*}", documentHandler.GetDocument).Methods("GET")
		apiRouter.HandleFunc("/document", documentHandler.CreateDocument).Methods("POST")
		apiRouter.HandleFunc("/document/{rest:.*}", documentHandler.UpdateDocument).Methods("PUT")
		apiRouter.HandleFunc("/document/{rest:.*}", documentHandler.DeleteDocument).Methods("DELETE")
		apiRouter.HandleFunc("/document/{rest:.*}/move", documentHandler.MoveDocument).Methods("POST")
		apiRouter.HandleFunc("/related/{rest:.*}", documentHandler.GetRelatedDocuments).Methods("GET")

		// Search route
		apiRouter.HandleFunc("/search", searchHandler.SearchDocuments).Methods("GET")

		// History route
		apiRouter.HandleFunc("/history/tree/{rest:.*}", documentHandler.GetDocumentHistory).Methods("GET")
		apiRouter.HandleFunc("/history/doc/{rest:.*}/{commit_id}", documentHandler.GetHistoricalDocument).Methods("GET")
		apiRouter.HandleFunc("/history/restore/{rest:.*}", documentHandler.RestoreHistoricalDocument).Methods("POST")

		// Drafts
		apiRouter.HandleFunc("/draft/{rest:.*}", documentHandler.GetDraftDocument).Methods("GET")
		apiRouter.HandleFunc("/drafts", documentHandler.GetAllDraftsDocument).Methods("GET")
		apiRouter.HandleFunc("/draft", documentHandler.UpsertDraftDocument).Methods("POST")
		apiRouter.HandleFunc("/draft/{rest:.*}", documentHandler.DeleteDraftDocument).Methods("DELETE")

		// ViewHistory
		apiRouter.HandleFunc("/views/last", documentHandler.GetLastViews).Methods("GET")

		// Favorites
		apiRouter.HandleFunc("/favorite", documentHandler.AddToFavorites).Methods("POST")
		apiRouter.HandleFunc("/favorite", documentHandler.RemoveFromFavorites).Methods("DELETE")
		apiRouter.HandleFunc("/favorites", documentHandler.GetFavorites).Methods("GET")

		// image and doc storer
		//apiRouter.HandleFunc("/v1/upload", documentHandler.HandleUploadOptions).Methods("OPTIONS")
		apiRouter.HandleFunc("/v1/upload", documentHandler.HandleUpload).Methods("POST")
		apiRouter.HandleFunc("/bucket", documentHandler.HandleBucketUpload).Methods("POST")
		apiRouter.HandleFunc("/file/{hash}", documentHandler.HandleFileDownload).Methods("GET")
	}

	spaFS, err := fs.Sub(staticFiles, "static")
	if err != nil {
		log.Fatal(err)
	}

	// Создаем кастомный файловый сервер для SPA
	spaFileServer := http.FileServer(http.FS(spaFS))

	r.PathPrefix("/").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Пропускаем API-запросы
		if strings.HasPrefix(r.URL.Path, "/api") {
			http.NotFound(w, r)
			return
		}

		// Проверяем существование файла
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}

		_, err := spaFS.Open(path)
		if err != nil {
			// Если файл не найден - отдаем index.html
			index, err := spaFS.Open("index.html")
			if err != nil {
				http.NotFound(w, r)
				return
			}
			defer index.Close()

			// Читаем весь файл в память (не идеально для больших файлов)
			stat, err := index.Stat()
			if err != nil {
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
				return
			}

			content, err := io.ReadAll(index)
			if err != nil {
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
				return
			}

			// Устанавливаем правильные заголовки
			w.Header().Set("Content-Type", "text/html")
			http.ServeContent(w, r, "index.html", stat.ModTime(), strings.NewReader(string(content)))
			return
		}

		// Если файл существует - отдаем его
		spaFileServer.ServeHTTP(w, r)
	})

	// Start server
	server := &http.Server{
		Addr:    ":8080",
		Handler: r,
	}

	go func() {
		log.Println("Server started at http://localhost:8080")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	// Wait for interrupt signal
	<-sigChan
	log.Println("Shutting down server...")
	if err := server.Shutdown(nil); err != nil {
		log.Fatal("Server shutdown error:", err)
	}
	log.Println("Server stopped")
}

type DocumentHandler struct {
	storage      Storage
	search       SearchIndex
	meta         *Metadata
	draftStorage *DraftStorage
}

func NewDocumentHandler(storage Storage, search SearchIndex, meta *Metadata, draftStorage *DraftStorage) *DocumentHandler {
	return &DocumentHandler{
		storage:      storage,
		search:       search,
		meta:         meta,
		draftStorage: draftStorage,
	}
}

func (h *DocumentHandler) GetDocumentHistory(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	docPath := vars["rest"]

	// Type assertion to get GitStorage
	gitStorage, ok := h.storage.(*GitStorage)
	if !ok {
		http.Error(w, "history feature only available with git storage", http.StatusNotImplemented)
		return
	}

	history, err := gitStorage.GetDocumentHistory(docPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(history)
}

func (h *DocumentHandler) GetHistoricalDocument(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	docPath := vars["rest"]
	commitID := vars["commit_id"]

	// Type assertion to get GitStorage
	gitStorage, ok := h.storage.(*GitStorage)
	if !ok {
		http.Error(w, "history feature only available with git storage", http.StatusNotImplemented)
		return
	}

	doc, err := gitStorage.GetHistoricalDocument(docPath, commitID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(doc)
}

func (h *DocumentHandler) RestoreHistoricalDocument(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	currentPath := vars["rest"]

	var request struct {
		CommitHash   string `json:"commitHash"`
		OriginalPath string `json:"originalPath"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// Type assertion to get GitStorage
	gitStorage, ok := h.storage.(*GitStorage)
	if !ok {
		http.Error(w, "history feature only available with git storage", http.StatusNotImplemented)
		return
	}

	// Restore the document
	restoredDoc, err := gitStorage.RestoreHistoricalDocument(currentPath, request.OriginalPath, request.CommitHash)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Update search index
	if err := h.search.DeleteDocument(currentPath); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := h.search.IndexDocument(restoredDoc); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(restoredDoc)
}

func (h *DocumentHandler) GetRootDocuments(w http.ResponseWriter, _ *http.Request) {
	docs, err := h.storage.GetRootDocuments()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(docs)
}

func (h *DocumentHandler) GetChildDocuments(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	parentPath := vars["rest"]
	docs, err := h.storage.GetChildDocuments(parentPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(docs)
}

func (h *DocumentHandler) GetDocument(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	docPath := vars["rest"]
	doc, err := h.storage.GetDocument(docPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	doc.Favorite = h.meta.IsFavorite(docPath)
	h.meta.UpdateViewedMeta(documentToShort(&doc))

	json.NewEncoder(w).Encode(doc)
}

func (h *DocumentHandler) GetRelatedDocuments(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	docPath := vars["rest"]

	related, err := h.storage.GetRelatedDocuments(docPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(related)
}

func (h *DocumentHandler) CreateDocument(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("draft")

	var req struct {
		ParentPath string `json:"parentPath"`
		Title      string `json:"title"`
		Content    string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var pathChanged bool
	doc, err := h.storage.CreateDocument(req.ParentPath, req.Title, req.Content)
	if err != nil {
		if !errors.Is(err, mkDirErr) {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		doc, err = h.storage.CreateDocument("", req.Title, req.Content)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		pathChanged = true
	}

	if err := h.search.IndexDocument(doc); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if query != "" {
		if err := h.draftStorage.DeleteDraft(query); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	if pathChanged {
		w.WriteHeader(http.StatusAccepted)
	}

	json.NewEncoder(w).Encode(doc)
}

func (h *DocumentHandler) UpdateDocument(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	docPath := vars["rest"]
	var req struct {
		Title         string `json:"title"`
		Content       string `json:"content"`
		CommitChanges bool   `json:"commit_changes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	doc, err := h.storage.UpdateDocument(docPath, req.Title, req.Content, req.CommitChanges)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if err := h.search.DeleteDocument(docPath); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if err := h.search.IndexDocument(doc); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	doc.Favorite = h.meta.IsFavorite(docPath)

	json.NewEncoder(w).Encode(doc)
}

func (h *DocumentHandler) DeleteDocument(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	docPath := vars["rest"]

	err := h.storage.DeleteDocument(docPath)
	if err != nil {
		status := http.StatusInternalServerError
		if err.Error() == "cannot delete document with children" {
			status = http.StatusBadRequest
		}
		http.Error(w, err.Error(), status)
		return
	}

	h.meta.RemoveFromFavorites(docPath)

	if err := h.search.DeleteDocument(docPath); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *DocumentHandler) MoveDocument(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sourcePath := vars["rest"]

	var req struct {
		TargetPath string `json:"targetPath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	err := h.storage.MoveDocument(sourcePath, req.TargetPath)
	if err != nil {
		status := http.StatusInternalServerError
		if strings.Contains(err.Error(), "does not exist") ||
			strings.Contains(err.Error(), "already exists") {
			status = http.StatusBadRequest
		}
		http.Error(w, err.Error(), status)
		return
	}

	isFavorite := h.meta.IsFavorite(sourcePath)
	if isFavorite {
		h.meta.RemoveFromFavorites(sourcePath)
	}

	if err := h.search.DeleteDocument(sourcePath); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	doc, err := h.storage.GetDocument(path.Join(req.TargetPath, filepath.Base(sourcePath)))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if isFavorite {
		h.meta.AddToFavorites(documentToShort(&doc))
	}

	if err := h.search.IndexDocument(doc); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(doc)
}

func (h *DocumentHandler) GetDraftDocument(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	draft, err := h.draftStorage.GetDraft(vars["rest"])
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	json.NewEncoder(w).Encode(draft)
}

func (h *DocumentHandler) GetAllDraftsDocument(w http.ResponseWriter, _ *http.Request) {
	drafts, err := h.draftStorage.GetAllDrafts()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Если drafts == nil, возвращаем пустой массив
	if drafts == nil {
		drafts = []Draft{}
	}

	json.NewEncoder(w).Encode(drafts)
}

func (h *DocumentHandler) UpsertDraftDocument(w http.ResponseWriter, r *http.Request) {
	var draft Draft
	if err := json.NewDecoder(r.Body).Decode(&draft); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := h.draftStorage.SetDraft(draft); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *DocumentHandler) DeleteDraftDocument(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	if err := h.draftStorage.DeleteDraft(vars["rest"]); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *DocumentHandler) GetLastViews(w http.ResponseWriter, _ *http.Request) {
	docs := h.meta.GetLastViewedDocuments()

	json.NewEncoder(w).Encode(docs)
}

func (h *DocumentHandler) AddToFavorites(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	doc, err := h.storage.GetDocument(req.Path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	h.meta.AddToFavorites(documentToShort(&doc))

	w.WriteHeader(http.StatusNoContent)
}

func (h *DocumentHandler) RemoveFromFavorites(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	_, err := h.storage.GetDocument(req.Path)
	if err != nil {
		if errors.Is(err, ErrDocumentNotFound) {
			h.meta.RemoveFromFavorites(req.Path)
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	h.meta.RemoveFromFavorites(req.Path)

	w.WriteHeader(http.StatusNoContent)
}

func (h *DocumentHandler) GetFavorites(w http.ResponseWriter, r *http.Request) {
	favorites := h.meta.GetFavorites()

	json.NewEncoder(w).Encode(favorites)
}

type SearchHandler struct {
	searchEngine *SearchEngine
}

func NewSearchHandler(searchEngine *SearchEngine) *SearchHandler {
	return &SearchHandler{searchEngine: searchEngine}
}

func (h *SearchHandler) SearchDocuments(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		http.Error(w, "query parameter 'q' is required", http.StatusBadRequest)
		return
	}

	// Get pagination parameters with defaults
	page, err := strconv.Atoi(r.URL.Query().Get("page"))
	if err != nil || page < 1 {
		page = 1
	}

	pageSize, err := strconv.Atoi(r.URL.Query().Get("pageSize"))
	if err != nil || pageSize < 1 {
		pageSize = 10
	}

	results, total, err := h.searchEngine.Search(query, page, pageSize)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Calculate total pages
	totalPages := total / pageSize
	if total%pageSize > 0 {
		totalPages++
	}

	response := SearchResults{
		Results:     results,
		Total:       total,
		CurrentPage: page,
		TotalPages:  totalPages,
		PageSize:    pageSize,
	}

	if response.Results == nil {
		response.Results = []Document{} // Return empty array instead of null
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

///////////////////////////////////////////////////////////////

func (h *DocumentHandler) HandleUploadOptions(w http.ResponseWriter, r *http.Request) {
	// Устанавливаем необходимые CORS заголовки
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	// Отправляем пустой ответ с кодом 200
	w.WriteHeader(http.StatusOK)
}

type UploadRequest struct {
	Data struct {
		ClientFileInfo struct {
			Type        string `json:"type"`
			Filename    string `json:"filename"`
			ContentType string `json:"contentType"`
			Bytes       int    `json:"bytes"`
			Width       int    `json:"width"`
			Height      int    `json:"height"`
		} `json:"clientFileInfo"`
	} `json:"data"`
}

type UploadResponse struct {
	Status string `json:"status"`
	Data   struct {
		APIUrl     string            `json:"apiUrl"`
		FileUrl    string            `json:"fileUrl"`
		FormFields map[string]string `json:"formFields"`
	} `json:"data"`
}

func (h *DocumentHandler) HandleUpload(w http.ResponseWriter, r *http.Request) {
	// Парсим входящий запрос
	var req UploadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Генерируем хэш для имени файла
	hash := generateFileHash(req.Data.ClientFileInfo.Filename)
	ext := filepath.Ext(req.Data.ClientFileInfo.Filename)
	if ext == "" {
		ext = ".png" // дефолтное расширение для изображений
	}
	fileName := hash + ext

	// Формируем ответ
	response := UploadResponse{
		Status: "success",
		Data: struct {
			APIUrl     string            `json:"apiUrl"`
			FileUrl    string            `json:"fileUrl"`
			FormFields map[string]string `json:"formFields"`
		}{
			APIUrl:  fmt.Sprintf("http://localhost:%s/api/bucket", getPort(r)),
			FileUrl: fmt.Sprintf("http://localhost:%s/api/file/%s", getPort(r), fileName),
			FormFields: map[string]string{
				"key": fileName,
			},
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// Вспомогательные функции
func getPort(r *http.Request) string {
	if r.URL.Port() != "" {
		return r.URL.Port()
	}
	if r.TLS == nil {
		return "8080"
	}
	return "443"
}

func generateFileHash(filename string) string {
	h := sha256.New()
	h.Write([]byte(filename + time.Now().String()))
	return hex.EncodeToString(h.Sum(nil))[:16]
}

const (
	uploadDir     = "./data/uploads" // Директория для сохранения файлов
	maxUploadSize = 10 << 30         // 1gb
)

func (h *DocumentHandler) HandleBucketUpload(w http.ResponseWriter, r *http.Request) {
	// Проверяем размер файла
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	if err := r.ParseMultipartForm(maxUploadSize); err != nil {
		http.Error(w, "File too large", http.StatusBadRequest)
		return
	}

	// Получаем файл из формы
	file, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Invalid file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Получаем ключ файла
	key := r.FormValue("key")
	if key == "" {
		http.Error(w, "Missing key parameter", http.StatusBadRequest)
		return
	}

	// Создаем директорию для загрузок, если ее нет
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		http.Error(w, "Failed to create upload directory", http.StatusInternalServerError)
		return
	}

	// Создаем файл на диске
	filePath := filepath.Join(uploadDir, key)
	dst, err := os.Create(filePath)
	if err != nil {
		http.Error(w, "Failed to create file", http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	// Копируем содержимое загруженного файла
	if _, err := io.Copy(dst, file); err != nil {
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}

	// Устанавливаем заголовки
	w.Header().Set("Access-Control-Allow-Methods", "HEAD, GET, PUT, POST")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Location", fmt.Sprintf("http://localhost:%s/api/file/%s", getPort(r), key))

	// Отправляем ответ без тела
	w.WriteHeader(http.StatusNoContent)
}

func (h *DocumentHandler) HandleFileDownload(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	hash := vars["hash"]

	filePath := filepath.Join(uploadDir, hash)

	// Проверяем существование файла
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		http.NotFound(w, r)
		return
	}

	// Получаем параметр size
	sizeParam := r.URL.Query().Get("size")
	if sizeParam != "" {
		// Парсим размеры
		var width, height int
		_, err := fmt.Sscanf(sizeParam, "%dx%d", &width, &height)
		if err != nil || width <= 0 || height <= 0 {
			http.Error(w, "Invalid size parameter", http.StatusBadRequest)
			return
		}

		// Читаем исходное изображение
		file, err := os.Open(filePath)
		if err != nil {
			http.Error(w, "Failed to open file", http.StatusInternalServerError)
			return
		}
		defer file.Close()

		img, _, err := image.Decode(file)
		if err != nil {
			http.Error(w, "Failed to decode image", http.StatusInternalServerError)
			return
		}

		// Создаем новое изображение с нужными размерами
		resizedImg := imaging.Resize(img, width, height, imaging.Lanczos)

		// Определяем Content-Type
		contentType := mime.TypeByExtension(filepath.Ext(filePath))
		if contentType == "" {
			contentType = "application/octet-stream"
		}

		w.Header().Set("Content-Type", contentType)

		// Кодируем изображение в ответ
		switch strings.ToLower(filepath.Ext(filePath)) {
		case ".jpg", ".jpeg":
			jpeg.Encode(w, resizedImg, nil)
		case ".png":
			png.Encode(w, resizedImg)
		case ".gif":
			gif.Encode(w, resizedImg, nil)
		default:
			// Если формат не поддерживается, отдаем как есть
			http.ServeFile(w, r, filePath)
		}
		return
	}

	// Если параметр size не указан, отдаем файл как есть
	contentType := mime.TypeByExtension(filepath.Ext(filePath))
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	w.Header().Set("Content-Type", contentType)
	http.ServeFile(w, r, filePath)
}
