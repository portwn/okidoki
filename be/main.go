// main.go
package main

import (
	"context"
	"embed"
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
	"regexp"
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
	Attachments []string        `json:"attachments,omitempty"`
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

// writeJSON serializes a value as JSON with a correct Content-Type.
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

type Storage interface {
	GetRootDocuments() ([]ShortDocument, error)
	GetRelatedDocuments(path string) (map[string][]ShortDocument, error)
	GetDocument(path string) (Document, error)
	GetChildDocuments(parentPath string) ([]ShortDocument, error)
	CreateDocument(parentPath, title, content string) (Document, error)
	UpdateDocument(path, title, content string, commitChanges bool) (Document, error)
	DeleteDocument(path string) error
	DeleteDocumentRecursive(path string) error
	MoveDocument(sourcePath, targetPath string) error
}

type SearchIndex interface {
	IndexDocument(doc Document) error
	IndexTree(storage Storage, doc Document) error
	DeleteDocument(docPath string) error
	DeleteSubtree(docPath string)
}

//go:embed static/*
var staticFiles embed.FS

func main() {
	// Channel for OS signals.
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

	md, err := NewMetadata("data", 1)
	if err != nil {
		log.Fatal(err)
	}
	defer md.Stop()

	// Interface language and search stemmer languages (OKIDOKI_LANG).
	lang := appLang()

	// Initialize search engine
	searchEngine := NewSearchEngine(searchLanguages(lang))
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

		// Attachments for documents and drafts.
		apiRouter.HandleFunc("/upload", documentHandler.HandleUpload).Methods("POST")
		apiRouter.HandleFunc("/docfile/{rest:.*}", documentHandler.HandleDocFile).Methods("GET")
		apiRouter.HandleFunc("/draftfile/{rest:.*}", documentHandler.HandleDraftFile).Methods("GET")

		// Runtime configuration consumed by the frontend on boot.
		apiRouter.HandleFunc("/config", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, map[string]any{
				"lang":        lang,
				"searchLangs": searchLanguages(lang),
			})
		}).Methods("GET")
	}

	spaFS, err := fs.Sub(staticFiles, "static")
	if err != nil {
		log.Fatal(err)
	}

	// Custom file server for the SPA.
	spaFileServer := http.FileServer(http.FS(spaFS))

	r.PathPrefix("/").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip API requests.
		if strings.HasPrefix(r.URL.Path, "/api") {
			http.NotFound(w, r)
			return
		}

		// Check whether the file exists.
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}

		_, err := spaFS.Open(path)
		if err != nil {
			// Not found — serve index.html.
			index, err := spaFS.Open("index.html")
			if err != nil {
				http.NotFound(w, r)
				return
			}
			defer index.Close()

			// Read the whole file into memory (not ideal for large files).
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

			// Set correct headers.
			w.Header().Set("Content-Type", "text/html")
			http.ServeContent(w, r, "index.html", stat.ModTime(), strings.NewReader(string(content)))
			return
		}

		// File exists — serve it.
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
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
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
	docPath := cleanRelPath(vars["rest"])

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

	writeJSON(w, history)
}

func (h *DocumentHandler) GetHistoricalDocument(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	docPath := cleanRelPath(vars["rest"])
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

	writeJSON(w, doc)
}

func (h *DocumentHandler) RestoreHistoricalDocument(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	currentPath := cleanRelPath(vars["rest"])

	var request struct {
		CommitHash   string `json:"commitHash"`
		OriginalPath string `json:"originalPath"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	request.OriginalPath = cleanRelPath(request.OriginalPath)

	if currentPath == "" || request.OriginalPath == "" {
		http.Error(w, "invalid path", http.StatusBadRequest)
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

	writeJSON(w, h.withAttachments(restoredDoc))
}

func (h *DocumentHandler) GetRootDocuments(w http.ResponseWriter, _ *http.Request) {
	docs, err := h.storage.GetRootDocuments()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, docs)
}

func (h *DocumentHandler) GetChildDocuments(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	parentPath := cleanRelPath(vars["rest"])
	docs, err := h.storage.GetChildDocuments(parentPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, docs)
}

func (h *DocumentHandler) GetDocument(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	docPath := cleanRelPath(vars["rest"])
	if docPath == "" {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	doc, err := h.storage.GetDocument(docPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	doc.Favorite = h.meta.IsFavorite(docPath)
	h.meta.UpdateViewedMeta(documentToShort(&doc))

	writeJSON(w, doc)
}

// withAttachments enriches a document with the list of attachments (files next
// to its .md) so the frontend can tell attachments from regular links.
func (h *DocumentHandler) withAttachments(doc Document) Document {
	if doc.Path == "" {
		return doc
	}
	if full, err := h.storage.GetDocument(doc.Path); err == nil {
		full.Favorite = doc.Favorite
		return full
	}
	return doc
}

func (h *DocumentHandler) GetRelatedDocuments(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	docPath := cleanRelPath(vars["rest"])

	related, err := h.storage.GetRelatedDocuments(docPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, related)
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

	if err := validateTitle(req.Title); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	req.ParentPath = cleanRelPath(req.ParentPath)

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
			return
		}
		pathChanged = true
	}

	if err := h.search.IndexDocument(doc); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if query != "" {
		// Move the draft attachments into the new document's folder and commit.
		if err := h.moveDraftAttachments(query, doc.Path); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if err := h.draftStorage.DeleteDraft(query); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	if pathChanged {
		w.WriteHeader(http.StatusAccepted)
	}

	writeJSON(w, h.withAttachments(doc))
}

func (h *DocumentHandler) UpdateDocument(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	oldPath := cleanRelPath(vars["rest"])
	var req struct {
		Title         string `json:"title"`
		Content       string `json:"content"`
		CommitChanges bool   `json:"commit_changes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if oldPath == "" {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	if err := validateTitle(req.Title); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	wasFavorite := h.meta.IsFavorite(oldPath)

	doc, err := h.storage.UpdateDocument(oldPath, req.Title, req.Content, req.CommitChanges)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if doc.Path != oldPath {
		// Renaming/changing the title changes the path of the root and all descendants.
		h.search.DeleteSubtree(oldPath)
		if err := h.search.IndexTree(h.storage, doc); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	} else if err := h.search.IndexDocument(doc); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if wasFavorite {
		h.meta.RemoveFromFavorites(oldPath)
		h.meta.AddToFavorites(documentToShort(&doc))
	}
	doc.Favorite = h.meta.IsFavorite(doc.Path)

	writeJSON(w, h.withAttachments(doc))
}

func (h *DocumentHandler) DeleteDocument(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	docPath := cleanRelPath(vars["rest"])
	recursive := r.URL.Query().Get("recursive") == "true"

	var err error
	if recursive {
		err = h.storage.DeleteDocumentRecursive(docPath)
	} else {
		err = h.storage.DeleteDocument(docPath)
	}
	if err != nil {
		status := http.StatusInternalServerError
		if err.Error() == "cannot delete document with children" {
			status = http.StatusBadRequest
		}
		http.Error(w, err.Error(), status)
		return
	}

	if recursive {
		h.meta.RemoveFromFavoritesPrefix(docPath)
		h.search.DeleteSubtree(docPath)
	} else {
		h.meta.RemoveFromFavorites(docPath)
		h.search.DeleteDocument(docPath)
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *DocumentHandler) MoveDocument(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sourcePath := cleanRelPath(vars["rest"])

	var req struct {
		TargetPath string `json:"targetPath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	targetPath := cleanRelPath(req.TargetPath)

	if sourcePath == "" {
		http.Error(w, "invalid source path", http.StatusBadRequest)
		return
	}
	if targetPath == sourcePath || strings.HasPrefix(targetPath, sourcePath+"/") {
		http.Error(w, "cannot move document into itself", http.StatusBadRequest)
		return
	}

	if err := h.storage.MoveDocument(sourcePath, targetPath); err != nil {
		status := http.StatusInternalServerError
		if strings.Contains(err.Error(), "does not exist") ||
			strings.Contains(err.Error(), "already exists") {
			status = http.StatusBadRequest
		}
		http.Error(w, err.Error(), status)
		return
	}

	newPath := path.Join(targetPath, filepath.Base(sourcePath))

	wasFavorite := h.meta.IsFavorite(sourcePath)

	// The path of the root and all descendants changed — drop the old subtree from the index.
	h.search.DeleteSubtree(sourcePath)

	doc, err := h.storage.GetDocument(newPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := h.search.IndexTree(h.storage, doc); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if wasFavorite {
		h.meta.RemoveFromFavorites(sourcePath)
		h.meta.AddToFavorites(documentToShort(&doc))
	}

	writeJSON(w, h.withAttachments(doc))
}

func (h *DocumentHandler) GetDraftDocument(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	draft, err := h.draftStorage.GetDraft(vars["rest"])
	if err != nil {
		status := http.StatusNotFound
		if errors.Is(err, ErrInvalidDraftID) {
			status = http.StatusBadRequest
		}
		http.Error(w, err.Error(), status)
		return
	}
	if entries, err := os.ReadDir(filepath.Join(h.draftStorage.Dir(), sanitizeSegment(vars["rest"]))); err == nil {
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			draft.Attachments = append(draft.Attachments, e.Name())
		}
	}
	writeJSON(w, draft)
}

func (h *DocumentHandler) GetAllDraftsDocument(w http.ResponseWriter, _ *http.Request) {
	drafts, err := h.draftStorage.GetAllDrafts()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// If drafts == nil, return an empty array.
	if drafts == nil {
		drafts = []Draft{}
	}

	writeJSON(w, drafts)
}

func (h *DocumentHandler) UpsertDraftDocument(w http.ResponseWriter, r *http.Request) {
	var draft Draft
	if err := json.NewDecoder(r.Body).Decode(&draft); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if err := h.draftStorage.SetDraft(draft); err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, ErrInvalidDraftID) || err.Error() == "draft ID cannot be empty" {
			status = http.StatusBadRequest
		}
		http.Error(w, err.Error(), status)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *DocumentHandler) DeleteDraftDocument(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	if err := h.draftStorage.DeleteDraft(vars["rest"]); err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, ErrInvalidDraftID) {
			status = http.StatusBadRequest
		}
		http.Error(w, err.Error(), status)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *DocumentHandler) GetLastViews(w http.ResponseWriter, _ *http.Request) {
	docs := h.meta.GetLastViewedDocuments()

	writeJSON(w, docs)
}

func (h *DocumentHandler) AddToFavorites(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	req.Path = cleanRelPath(req.Path)
	if req.Path == "" {
		http.Error(w, "invalid path", http.StatusBadRequest)
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

	req.Path = cleanRelPath(req.Path)
	if req.Path == "" {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}

	if _, err := h.storage.GetDocument(req.Path); err != nil {
		// The document may already be gone — just remove it from favorites.
		if errors.Is(err, ErrDocumentNotFound) {
			h.meta.RemoveFromFavorites(req.Path)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	h.meta.RemoveFromFavorites(req.Path)

	w.WriteHeader(http.StatusNoContent)
}

func (h *DocumentHandler) GetFavorites(w http.ResponseWriter, r *http.Request) {
	favorites := h.meta.GetFavorites()

	writeJSON(w, favorites)
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
	writeJSON(w, response)
}

///////////////////////////////////////////////////////////////

const defaultMaxUploadMB = 2048 // 2 GiB

// appLang returns the interface language from OKIDOKI_LANG ("ru" or "en").
// Anything unset or unrecognized falls back to "ru".
func appLang() string {
	if strings.ToLower(strings.TrimSpace(os.Getenv("OKIDOKI_LANG"))) == "en" {
		return "en"
	}
	return "ru"
}

// searchLanguages maps the app language to snowball stemmer languages.
// English is always included so mixed-language content still matches.
func searchLanguages(lang string) []string {
	if lang == "en" {
		return []string{"english"}
	}
	return []string{"english", "russian"}
}

// maxUploadBytes returns the upload size limit for a single file.
// Overridden by the OKIDOKI_MAX_UPLOAD_MB environment variable.
func maxUploadBytes() int64 {
	fallback := int64(defaultMaxUploadMB) << 20
	v := strings.TrimSpace(os.Getenv("OKIDOKI_MAX_UPLOAD_MB"))
	if v == "" {
		return fallback
	}
	mb, err := strconv.ParseInt(v, 10, 64)
	if err != nil || mb <= 0 {
		log.Printf("OKIDOKI_MAX_UPLOAD_MB=%q is invalid, using %d MiB", v, defaultMaxUploadMB)
		return fallback
	}
	return mb << 20
}

// HandleUpload accepts a multipart file and stores it next to the document's
// .md (form "path") or into a draft folder (form "draft"). Returns the file name.
func (h *DocumentHandler) HandleUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes())
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		http.Error(w, "File too large", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Invalid file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	dir, err := h.attachmentDir(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	name := sanitizeAttachmentName(header.Filename)
	if name == "" {
		http.Error(w, "Invalid file name", http.StatusBadRequest)
		return
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		http.Error(w, "Failed to create directory", http.StatusInternalServerError)
		return
	}
	name = uniqueFileName(dir, name)

	dst, err := os.Create(filepath.Join(dir, name))
	if err != nil {
		http.Error(w, "Failed to create file", http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	size, err := io.Copy(dst, file)
	if err != nil {
		os.Remove(filepath.Join(dir, name))
		http.Error(w, "Failed to save file", http.StatusInternalServerError)
		return
	}

	contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(name)))
	resp := struct {
		Path    string `json:"path"`
		Name    string `json:"name"`
		IsImage bool   `json:"isImage"`
		Size    int64  `json:"size"`
	}{
		Path:    name,
		Name:    name,
		IsImage: strings.HasPrefix(contentType, "image/"),
		Size:    size,
	}

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, resp)
}

// attachmentDir determines the upload directory: a document folder or a draft folder.
func (h *DocumentHandler) attachmentDir(r *http.Request) (string, error) {
	if draftID := r.FormValue("draft"); draftID != "" {
		return filepath.Join(h.draftStorage.Dir(), sanitizeSegment(draftID)), nil
	}
	if docPath := r.FormValue("path"); docPath != "" {
		gs, ok := h.storage.(*GitStorage)
		if !ok {
			return "", fmt.Errorf("attachments are not supported by this storage")
		}
		rel := cleanRelPath(docPath)
		if rel == "" {
			return "", fmt.Errorf("invalid document path")
		}
		full := filepath.Join(gs.DocsDir(), filepath.FromSlash(rel))
		if info, err := os.Stat(full); err != nil || !info.IsDir() {
			return "", fmt.Errorf("document not found")
		}
		return full, nil
	}
	return "", fmt.Errorf("path or draft is required")
}

func (h *DocumentHandler) HandleDocFile(w http.ResponseWriter, r *http.Request) {
	gs, ok := h.storage.(*GitStorage)
	if !ok {
		http.Error(w, "not supported", http.StatusNotImplemented)
		return
	}
	rest := mux.Vars(r)["rest"]
	idx := strings.LastIndex(rest, "/")
	if idx <= 0 || idx == len(rest)-1 {
		http.NotFound(w, r)
		return
	}
	docPath := cleanRelPath(rest[:idx])
	name := sanitizeAttachmentName(rest[idx+1:])
	h.serveAttachment(w, r, filepath.Join(gs.DocsDir(), filepath.FromSlash(docPath), name))
}

func (h *DocumentHandler) HandleDraftFile(w http.ResponseWriter, r *http.Request) {
	rest := mux.Vars(r)["rest"]
	idx := strings.LastIndex(rest, "/")
	if idx <= 0 || idx == len(rest)-1 {
		http.NotFound(w, r)
		return
	}
	draftID := sanitizeSegment(rest[:idx])
	name := sanitizeAttachmentName(rest[idx+1:])
	h.serveAttachment(w, r, filepath.Join(h.draftStorage.Dir(), draftID, name))
}

// serveAttachment serves a file from disk, supporting ?size=WxH for images.
func (h *DocumentHandler) serveAttachment(w http.ResponseWriter, r *http.Request, filePath string) {
	info, err := os.Stat(filePath)
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}

	contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(filePath)))
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	if sizeParam := r.URL.Query().Get("size"); sizeParam != "" && strings.HasPrefix(contentType, "image/") {
		var width, height int
		if _, err := fmt.Sscanf(sizeParam, "%dx%d", &width, &height); err != nil || width <= 0 || height <= 0 {
			http.Error(w, "Invalid size parameter", http.StatusBadRequest)
			return
		}
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
		resized := imaging.Resize(img, width, height, imaging.Lanczos)
		w.Header().Set("Content-Type", contentType)
		switch strings.ToLower(filepath.Ext(filePath)) {
		case ".jpg", ".jpeg":
			jpeg.Encode(w, resized, nil)
		case ".png":
			png.Encode(w, resized)
		case ".gif":
			gif.Encode(w, resized, nil)
		default:
			http.ServeFile(w, r, filePath)
		}
		return
	}

	w.Header().Set("Content-Type", contentType)
	// Serve non-images as attachments — clicking the link downloads the file.
	if !strings.HasPrefix(contentType, "image/") {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{
			"filename": filepath.Base(filePath),
		}))
	}
	http.ServeFile(w, r, filePath)
}

// moveDraftAttachments moves files from a draft staging folder into the
// created document's folder. Names are unchanged, so relative links in the
// markdown stay valid.
func (h *DocumentHandler) moveDraftAttachments(draftID, docPath string) error {
	srcDir := filepath.Join(h.draftStorage.Dir(), sanitizeSegment(draftID))
	if _, err := os.Stat(srcDir); os.IsNotExist(err) {
		return nil
	}
	gs, ok := h.storage.(*GitStorage)
	if !ok {
		return nil
	}
	// Moving files and committing must be atomic with respect to other
	// storage mutations (see GitStorage.writeMu).
	gs.LockWrites()
	defer gs.UnlockWrites()

	dstDir := filepath.Join(gs.DocsDir(), filepath.FromSlash(cleanRelPath(docPath)))
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return err
	}

	entries, err := os.ReadDir(srcDir)
	if err != nil {
		return err
	}
	moved := false
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if err := os.Rename(filepath.Join(srcDir, e.Name()), filepath.Join(dstDir, e.Name())); err != nil {
			return err
		}
		moved = true
	}
	os.RemoveAll(srcDir)

	if moved {
		if err := gs.commitChanges(fmt.Sprintf("Add attachments for document: %s", docPath)); err != nil {
			return err
		}
	}
	return nil
}

var attachmentUnsafe = regexp.MustCompile(`[\\/:*?"<>|\x00-\x1f]`)

func sanitizeAttachmentName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.TrimSpace(name)
	name = attachmentUnsafe.ReplaceAllString(name, "-")
	name = strings.TrimLeft(name, ".")
	if name == "" {
		return ""
	}
	if strings.EqualFold(filepath.Ext(name), ".md") {
		name += ".txt"
	}
	return name
}

func sanitizeSegment(segment string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			return r
		default:
			return '-'
		}
	}, segment)
}

func uniqueFileName(dir, name string) string {
	if _, err := os.Stat(filepath.Join(dir, name)); os.IsNotExist(err) {
		return name
	}
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for i := 1; ; i++ {
		candidate := fmt.Sprintf("%s-%d%s", base, i, ext)
		if _, err := os.Stat(filepath.Join(dir, candidate)); os.IsNotExist(err) {
			return candidate
		}
	}
}

// cleanRelPath normalizes a path inside docs (no leading slash, no escaping upwards).
func cleanRelPath(p string) string {
	p = strings.ReplaceAll(p, "\\", "/")
	cleaned := path.Clean("/" + strings.TrimPrefix(p, "/"))
	return strings.TrimPrefix(cleaned, "/")
}

const maxTitleLength = 200

// validateTitle validates a title that becomes the .md file name.
func validateTitle(title string) error {
	title = strings.TrimSpace(title)
	if title == "" {
		return fmt.Errorf("title is required")
	}
	if len([]rune(title)) > maxTitleLength {
		return fmt.Errorf("title is too long")
	}
	if strings.ContainsAny(title, `/\:*?"<>|`) {
		return fmt.Errorf("title contains forbidden characters")
	}
	return nil
}
