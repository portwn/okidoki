// storage_git.go
package main

import (
	"fmt"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/mozillazg/go-unidecode"
	"github.com/pkg/errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing/object"
)

type GitStorage struct {
	baseDir string // "data"
	docsDir string // "data/docs"
	repo    *git.Repository
}

type CommitHistory struct {
	CommitHash string    `json:"commitHash"`
	Date       time.Time `json:"date"`
	Message    string    `json:"message"`
	//Change     string    `json:"change"`
	Added    int    `json:"added"`
	Deleted  int    `json:"deleted"`
	FilePath string `json:"filePath"` // Path of the file at the time of commit
}

type DocumentHistoryResponse struct {
	History []CommitHistory `json:"history"`
}

func NewGitStorage(baseDir string) (*GitStorage, error) {
	// Создаем базовую директорию если ее нет
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create base directory: %w", err)
	}

	// Создаем директорию для документов
	docsDir := filepath.Join(baseDir, "docs")
	if err := os.MkdirAll(docsDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create docs directory: %w", err)
	}

	// Открываем или инициализируем git репозиторий в базовой директории
	repo, err := git.PlainOpen(baseDir)
	if errors.Is(err, git.ErrRepositoryNotExists) {
		repo, err = git.PlainInit(baseDir, false)
		if err != nil {
			return nil, fmt.Errorf("failed to init git repository: %w", err)
		}
	} else if err != nil {
		return nil, fmt.Errorf("failed to open git repository: %w", err)
	}

	return &GitStorage{
		baseDir: baseDir,
		docsDir: docsDir,
		repo:    repo,
	}, nil
}

func (gs *GitStorage) commitChanges(message string) error {
	w, err := gs.repo.Worktree()
	if err != nil {
		return fmt.Errorf("failed to get worktree: %w", err)
	}

	// Add all changes
	_, err = w.Add(".")
	if err != nil {
		return fmt.Errorf("failed to add changes: %w", err)
	}

	// Check if there are any changes to commit
	status, err := w.Status()
	if err != nil {
		return fmt.Errorf("failed to get status: %w", err)
	}

	if status.IsClean() {
		return nil // No changes to commit
	}

	// Commit changes
	_, err = w.Commit(message, &git.CommitOptions{
		Author: &object.Signature{
			Name:  "Document System",
			Email: "docs@system",
			When:  time.Now(),
		},
	})
	if err != nil {
		return fmt.Errorf("failed to commit changes: %w", err)
	}

	return nil
}

func (gs *GitStorage) GetRootDocuments() ([]ShortDocument, error) {
	return gs.getDocuments(gs.docsDir, "")
}

func (gs *GitStorage) GetRelatedDocuments(docPath string) (map[string][]ShortDocument, error) {
	// Similar implementation as FileStorage but using git
	result := make(map[string][]ShortDocument)

	parts := strings.Split(docPath, "/")
	currentPath := ""

	for i, part := range parts {
		if part == "" {
			continue
		}

		if currentPath == "" {
			currentPath = part
		} else {
			currentPath = filepath.Join(currentPath, part)
		}

		var currentDirDocs []ShortDocument
		var err error
		if currentPath != "" {
			currentDirDocs, err = gs.GetChildDocuments(currentPath)
			if err != nil {
				return nil, err
			}
			result[currentPath] = currentDirDocs
		}

		var siblings []ShortDocument
		parentPath := filepath.Dir(currentPath)
		if parentPath == "." {
			siblings, err = gs.GetRootDocuments()
		} else {
			siblings, err = gs.GetChildDocuments(parentPath)
		}
		if err != nil {
			return nil, err
		}

		key := ""
		if i == 0 {
			key = "root"
		} else {
			key = strings.Join(parts[:i], "/")
		}
		result[key] = siblings
	}

	return result, nil
}

var ErrDocumentNotFound = fmt.Errorf("document not found")

func (gs *GitStorage) GetDocument(docPath string) (Document, error) {
	fullPath := filepath.Join(gs.docsDir, filepath.FromSlash(docPath))
	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		return Document{}, ErrDocumentNotFound
	}

	doc, err := gs.readDocument(docPath)
	if err != nil {
		return Document{}, err
	}

	uncommited, err := gs.isUncommited(docPath)
	if err != nil {
		return Document{}, err
	}

	doc.Uncommitted = uncommited

	return *doc, nil
}

func (gs *GitStorage) isUncommited(docPath string) (bool, error) {
	w, err := gs.repo.Worktree()
	if err != nil {
		return false, fmt.Errorf("failed to get worktree: %w", err)
	}

	status, err := w.Status()
	if err != nil {
		return false, fmt.Errorf("failed to get git status: %w", err)
	}

	// Получаем относительный путь к файлу документа
	title, err := gs.getTitle(docPath)
	if err != nil {
		return false, err
	}
	relFilePath := filepath.Join("docs", docPath, title+".md")
	relFilePath = filepath.ToSlash(relFilePath) // Нормализуем путь для git

	// Проверяем статус файла документа
	fileStatus, ok := status[relFilePath]
	if ok && (fileStatus.Worktree != git.Unmodified || fileStatus.Staging != git.Unmodified) {
		return true, nil
	}

	// Проверяем статус директории документа (на случай если изменились дочерние элементы)
	relDirPath := filepath.Join("docs", docPath)
	relDirPath = filepath.ToSlash(relDirPath) + "/"

	for filePath := range status {
		if strings.HasPrefix(filePath, relDirPath) {
			fstatus := status[filePath]
			if fstatus.Worktree != git.Unmodified || fileStatus.Staging != git.Unmodified {
				return true, nil
			}
		}
	}

	return false, nil
}

func (gs *GitStorage) GetChildDocuments(parentPath string) ([]ShortDocument, error) {
	fullPath := filepath.Join(gs.docsDir, filepath.FromSlash(parentPath))
	return gs.getDocuments(fullPath, parentPath)
}

var mkDirErr = fmt.Errorf("mkdir")

func (gs *GitStorage) CreateDocument(parentPath, title, content string) (Document, error) {
	id := gs.generateID(parentPath, title)
	var fullPath string

	if parentPath == "" {
		fullPath = filepath.Join(gs.docsDir, id)
	} else {
		fullPath = filepath.Join(gs.docsDir, filepath.FromSlash(parentPath), id)
	}

	if err := os.Mkdir(fullPath, 0755); err != nil {
		return Document{}, mkDirErr
	}

	docFilePath := filepath.Join(fullPath, title+".md")
	if err := os.WriteFile(docFilePath, []byte(content), 0644); err != nil {
		os.RemoveAll(fullPath)
		return Document{}, err
	}

	newDocPath := path.Join(parentPath, id)

	if err := gs.commitChanges(fmt.Sprintf("Create document: %s", newDocPath)); err != nil {
		os.RemoveAll(fullPath)
		return Document{}, fmt.Errorf("failed to commit changes: %w", err)
	}

	children, err := gs.getChildren(parentPath)
	if err != nil {
		return Document{}, err
	}

	return Document{
		ID:       id,
		Title:    title,
		Content:  content,
		Children: children,
		Path:     newDocPath,
	}, nil
}

func (gs *GitStorage) UpdateDocument(docPath, title, content string, commitChanges bool) (Document, error) {
	fullPath := filepath.Join(gs.docsDir, filepath.FromSlash(docPath))
	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		return Document{}, fmt.Errorf("document not found")
	}

	currentDoc, err := gs.GetDocument(docPath)
	if err != nil {
		return Document{}, err
	}

	var newPath string
	if title != currentDoc.Title {
		oldTitle, err := gs.getTitle(docPath)
		if err != nil {
			return Document{}, err
		}
		if err := os.Rename(
			filepath.Join(gs.docsDir, docPath, oldTitle+".md"),
			filepath.Join(gs.docsDir, docPath, title+".md"),
		); err != nil {
			return Document{}, err
		}

		newID := gs.generateID(docPath, title)
		newPath = filepath.Join(filepath.Dir(fullPath), newID)
		if err := os.Rename(fullPath, newPath); err != nil {
			return Document{}, err
		}
		fullPath = newPath
		docPath = path.Join(filepath.Dir(docPath), newID)
	}

	docFilePath := filepath.Join(fullPath, title+".md")
	if err := os.WriteFile(docFilePath, []byte(content), 0644); err != nil {
		return Document{}, err
	}

	if commitChanges {
		if err := gs.commitChanges(fmt.Sprintf("Update document: %s", docPath)); err != nil {
			return Document{}, fmt.Errorf("failed to commit changes: %w", err)
		}
	}

	children, err := gs.getChildren(docPath)
	if err != nil {
		return Document{}, err
	}

	return Document{
		ID:       filepath.Base(docPath),
		Title:    title,
		Content:  content,
		Children: children,
		Path:     docPath,
	}, nil
}

func (gs *GitStorage) DeleteDocument(path string) error {
	fullPath := filepath.Join(gs.docsDir, filepath.FromSlash(path))

	hasChildren, err := gs.hasChildren(path)
	if err != nil {
		return err
	}
	if hasChildren {
		return fmt.Errorf("cannot delete document with children")
	}

	if err := os.RemoveAll(fullPath); err != nil {
		return err
	}

	if err := gs.commitChanges(fmt.Sprintf("Delete document: %s", path)); err != nil {
		return fmt.Errorf("failed to commit changes: %w", err)
	}

	return nil
}

func (gs *GitStorage) MoveDocument(sourcePath, targetPath string) error {
	sourceFullPath := filepath.Join(gs.docsDir, filepath.FromSlash(sourcePath))
	targetFullPath := filepath.Join(gs.docsDir, filepath.FromSlash(targetPath), filepath.Base(sourcePath))

	if _, err := os.Stat(filepath.Dir(targetFullPath)); os.IsNotExist(err) {
		return fmt.Errorf("target directory does not exist")
	}

	if _, err := os.Stat(sourceFullPath); os.IsNotExist(err) {
		return fmt.Errorf("source document does not exist")
	}

	if _, err := os.Stat(targetFullPath); err == nil {
		return fmt.Errorf("target document already exists")
	}

	if err := os.Rename(sourceFullPath, targetFullPath); err != nil {
		return err
	}

	if err := gs.commitChanges(fmt.Sprintf("Move document from %s to %s", sourcePath, targetPath)); err != nil {
		return fmt.Errorf("failed to commit changes: %w", err)
	}

	return nil
}

// Helper methods (similar to FileStorage but with git integration)

func (gs *GitStorage) getDocuments(dir, parentPath string) ([]ShortDocument, error) {
	files, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	var docs []ShortDocument
	for _, f := range files {
		if !f.IsDir() {
			continue
		}

		id := f.Name()
		docPath := path.Join(parentPath, id)
		children, err := gs.getChildren(docPath)
		if err != nil {
			return nil, err
		}
		title, err := gs.getTitle(docPath)
		if err != nil {
			return nil, err
		}

		docs = append(docs, ShortDocument{
			ID:          id,
			Title:       title,
			HasChildren: len(children) > 0,
			Path:        docPath,
		})
	}
	return docs, nil
}

func (gs *GitStorage) getChildren(docPath string) ([]ShortDocument, error) {
	fullPath := filepath.Join(gs.docsDir, filepath.FromSlash(docPath))
	files, err := os.ReadDir(fullPath)
	if err != nil {
		return nil, err
	}

	var children []ShortDocument
	for _, f := range files {
		if f.IsDir() {
			childTitle, err := os.ReadDir(filepath.Join(fullPath, f.Name()))
			if err != nil {
				return nil, err
			}
			var title string
			var hasChildren bool

			for _, ff := range childTitle {
				if !ff.IsDir() {
					title = strings.TrimSuffix(ff.Name(), ".md")
				} else {
					hasChildren = true
				}
			}
			children = append(children, ShortDocument{
				ID:          f.Name(),
				Title:       title,
				HasChildren: hasChildren,
				Path:        path.Join(docPath, f.Name()),
			})
		}
	}
	return children, nil
}

func (gs *GitStorage) hasChildren(docPath string) (bool, error) {
	fullPath := filepath.Join(gs.docsDir, filepath.FromSlash(docPath))
	files, err := os.ReadDir(fullPath)
	if err != nil {
		return false, err
	}

	for _, f := range files {
		if f.IsDir() {
			return true, nil
		}
	}
	return false, nil
}

func (gs *GitStorage) readDocument(docPath string) (*Document, error) {
	files, err := os.ReadDir(filepath.Join(gs.docsDir, filepath.FromSlash(docPath)))
	if err != nil {
		return nil, err
	}

	for _, f := range files {
		if !f.IsDir() {
			filePath := filepath.Join(gs.docsDir, filepath.FromSlash(docPath), f.Name())

			info, err := os.Stat(filePath)
			if err != nil {
				return nil, err
			}

			children, err := gs.getChildren(docPath)
			if err != nil {
				return nil, err
			}

			data, err := os.ReadFile(filePath)
			if err != nil {
				return nil, err
			}

			return &Document{
				ID:       filepath.Base(docPath),
				Title:    strings.TrimSuffix(f.Name(), ".md"),
				Content:  string(data),
				Children: children,
				Modified: info.ModTime(),
				Path:     docPath,
			}, nil
		}
	}

	return nil, fmt.Errorf("document not found")
}

var nonAlphanumericRegex = regexp.MustCompile(`[^a-zA-Z0-9_]+`)

func (gs *GitStorage) generateID(parentPath, title string) string {
	transliterated := unidecode.Unidecode(title)
	id := strings.ReplaceAll(transliterated, " ", "_")
	id = nonAlphanumericRegex.ReplaceAllString(id, "")
	id = strings.ToLower(id)

	baseID := id
	counter := 1
	for {
		fpath := filepath.Join(gs.docsDir, parentPath, id) // Теперь используем переданный baseDir
		if id != "root" {
			if _, err := os.Stat(fpath); os.IsNotExist(err) {
				break
			}
		}
		id = fmt.Sprintf("%s(%d)", baseID, counter)
		counter++
	}
	return id
}

func (gs *GitStorage) getTitle(path string) (string, error) {
	files, err := os.ReadDir(filepath.Join(gs.docsDir, path))
	if err != nil {
		return "", err
	}
	for _, f := range files {
		if !f.IsDir() {
			return strings.TrimSuffix(f.Name(), ".md"), nil
		}
	}

	return "", fmt.Errorf("title not found")
}

func (gs *GitStorage) GetDocumentHistory(docPath string) (DocumentHistoryResponse, error) {
	visited := make(map[plumbing.Hash]bool)

	return gs.getDocumentHistory(filepath.Join(docPath), "", visited)
}

func trimMD(s string) string {
	return strings.TrimSuffix(s, ".md")
}

type getDocumentHistoryResponse struct {
	changes []*object.Change
}

func (gs *GitStorage) getDocumentHistory(docPath string, filePath string, visited map[plumbing.Hash]bool) (DocumentHistoryResponse, error) {

	// Check if path exists
	if docPath != "" {
		if _, err := os.Stat(filepath.Join(gs.docsDir, docPath)); os.IsNotExist(err) {
			return DocumentHistoryResponse{}, fmt.Errorf("document not found")
		}
	}

	cIter, err := gs.repo.Log(&git.LogOptions{
		PathFilter: func(s string) bool {
			if filePath == "" {
				title, err := gs.getTitle(docPath)
				if err != nil {
					return false
				}
				filePath = filepath.Join(gs.docsDir, docPath, title+".md")

			} else {
				s = filepath.Join(gs.baseDir, s)
			}

			return filepath.FromSlash(s) == filepath.FromSlash(filePath)
		},
		Order: git.LogOrderCommitterTime,
	})
	if err != nil {
		return DocumentHistoryResponse{}, fmt.Errorf("failed to get git log: %w", err)
	}

	var history []CommitHistory
	processedHashes := make(map[string]bool)

	// Iterate through commits
	err = cIter.ForEach(func(c *object.Commit) error {
		if c.NumParents() == 0 {
			return nil // Skip initial commit
		}

		parent, err := c.Parent(0)
		if err != nil {
			return err
		}

		currentTree, err := c.Tree()
		if err != nil {
			return err
		}

		parentTree, err := parent.Tree()
		if err != nil {
			return err
		}

		changes, err := object.DiffTree(parentTree, currentTree)
		if err != nil {
			return err
		}

		var nested func() (DocumentHistoryResponse, error)
		var relevantChanges []*object.Change
		for _, change := range changes {
			from, to, err := change.Files()
			if err != nil {
				return err
			}

			if from != nil && to == nil {
				if _, ok := visited[from.Hash]; !ok {
					visited[from.Hash] = true
					relevantChanges = append(relevantChanges, change)
					nested = func() (DocumentHistoryResponse, error) {
						resp, err := gs.getDocumentHistory("", filepath.Join(gs.baseDir, change.From.Name), visited)
						if err != nil {
							return DocumentHistoryResponse{}, err
						}
						return resp, nil
					}
				}
			} else {
				var hash plumbing.Hash
				if from != nil && to != nil {
					relevantChanges = append(relevantChanges, change)
				} else {
					if from != nil {
						hash = from.Hash
					}
					if to != nil {
						hash = to.Hash
					}
					if _, ok := visited[hash]; !ok {
						relevantChanges = append(relevantChanges, change)
						visited[hash] = true
					}
				}

			}
		}

		if len(relevantChanges) == 0 {
			return nil // Skip commits that didn't modify our file
		}

		// Skip if we've already processed this commit (can happen with merges)
		if processedHashes[c.Hash.String()] {
			return nil
		}
		processedHashes[c.Hash.String()] = true

		fstats, err := c.Stats()
		if err != nil {
			return err
		}

		// Calculate added/deleted lines across all relevant changes
		var added, deleted int
		for _, stat := range fstats {
			added += stat.Addition
			deleted += stat.Deletion
		}

		splitted := strings.Split(strings.TrimPrefix(filePath, gs.docsDir+"/"), "/")
		location := strings.Join(splitted[:len(splitted)-1], "/")

		history = append(history, CommitHistory{
			CommitHash: c.Hash.String(),
			Date:       c.Author.When,
			Message:    c.Message,
			Added:      added,
			Deleted:    deleted,
			FilePath:   location, // Shows the path at the time of commit
		})

		if nested != nil {
			rep, err := nested()
			if err != nil {
				return err
			}
			history = append(history, rep.History...)
			nested = nil
		}
		return nil
	})

	if err != nil {
		return DocumentHistoryResponse{}, fmt.Errorf("error processing commit history: %w", err)
	}

	return DocumentHistoryResponse{
		History: history,
	}, nil
}

func (gs *GitStorage) GetHistoricalDocument(docPath, commitID string) (Document, error) {
	// Verify the commit exists
	commitHash := plumbing.NewHash(commitID)
	commit, err := gs.repo.CommitObject(commitHash)
	if err != nil {
		return Document{}, fmt.Errorf("commit not found: %w", err)
	}

	// Get the tree for this commit
	tree, err := commit.Tree()
	if err != nil {
		return Document{}, fmt.Errorf("failed to get commit tree: %w", err)
	}

	// Build the full path to the document in the repo
	fullPath := filepath.Join("docs", filepath.FromSlash(docPath))

	// Find the directory entry in the tree
	dirEntry, err := tree.FindEntry(fullPath)
	if err != nil {
		return Document{}, fmt.Errorf("document not found in this commit: %w", err)
	}

	// Get the subtree for our document directory
	subTree, err := gs.repo.TreeObject(dirEntry.Hash)
	if err != nil {
		return Document{}, fmt.Errorf("failed to get document subtree: %w", err)
	}

	// Find the .md file in the directory
	var title string
	var content string
	for _, entry := range subTree.Entries {
		if strings.HasSuffix(entry.Name, ".md") {
			// Get the file content
			blob, err := gs.repo.BlobObject(entry.Hash)
			if err != nil {
				return Document{}, fmt.Errorf("failed to get file blob: %w", err)
			}

			reader, err := blob.Reader()
			if err != nil {
				return Document{}, fmt.Errorf("failed to read file content: %w", err)
			}
			defer reader.Close()

			data, err := io.ReadAll(reader)
			if err != nil {
				return Document{}, fmt.Errorf("failed to read file data: %w", err)
			}

			title = strings.TrimSuffix(entry.Name, ".md")
			content = string(data)
			break
		}
	}

	if title == "" {
		return Document{}, fmt.Errorf("no document file found in directory")
	}

	return Document{
		ID:       filepath.Base(docPath),
		Title:    title,
		Content:  content,
		Path:     docPath,
		Children: []ShortDocument{}, // We don't load full children for historical versions
	}, nil
}

func (gs *GitStorage) RestoreHistoricalDocument(currentPath, originalPath, commitID string) (Document, error) {
	// Verify the commit exists
	commitHash := plumbing.NewHash(commitID)
	commit, err := gs.repo.CommitObject(commitHash)
	if err != nil {
		return Document{}, fmt.Errorf("commit not found: %w", err)
	}

	// Get the tree for this commit
	tree, err := commit.Tree()
	if err != nil {
		return Document{}, fmt.Errorf("failed to get commit tree: %w", err)
	}

	// Find the historical document in the original path
	historicalFullPath := filepath.Join("docs", filepath.FromSlash(originalPath))
	historicalEntry, err := tree.FindEntry(historicalFullPath)
	if err != nil {
		return Document{}, fmt.Errorf("historical document not found in commit: %w", err)
	}

	// Get the historical document content
	historicalSubTree, err := gs.repo.TreeObject(historicalEntry.Hash)
	if err != nil {
		return Document{}, fmt.Errorf("failed to get historical document subtree: %w", err)
	}

	var historicalTitle string
	var historicalContent string
	for _, entry := range historicalSubTree.Entries {
		if strings.HasSuffix(entry.Name, ".md") {
			blob, err := gs.repo.BlobObject(entry.Hash)
			if err != nil {
				return Document{}, fmt.Errorf("failed to get file blob: %w", err)
			}

			reader, err := blob.Reader()
			if err != nil {
				return Document{}, fmt.Errorf("failed to read file content: %w", err)
			}
			defer reader.Close()

			data, err := io.ReadAll(reader)
			if err != nil {
				return Document{}, fmt.Errorf("failed to read file data: %w", err)
			}

			historicalTitle = strings.TrimSuffix(entry.Name, ".md")
			historicalContent = string(data)
			break
		}
	}

	if historicalTitle == "" {
		return Document{}, fmt.Errorf("no document file found in historical directory")
	}

	// Get current document to compare
	currentFullPath := filepath.Join(gs.docsDir, filepath.FromSlash(currentPath))
	currentDoc, err := gs.GetDocument(currentPath)
	if err != nil && !os.IsNotExist(err) {
		return Document{}, fmt.Errorf("failed to get current document: %w", err)
	}

	// If the document was moved, we need to handle that
	if currentPath != originalPath {
		// Check if the original path structure exists
		originalDir := filepath.Dir(filepath.Join(gs.docsDir, originalPath))
		if _, err := os.Stat(originalDir); os.IsNotExist(err) {
			if err := os.MkdirAll(originalDir, 0755); err != nil {
				return Document{}, fmt.Errorf("failed to create original directory structure: %w", err)
			}
		}
	}

	currentTitle, err := gs.getTitle(filepath.FromSlash(currentPath))
	if err != nil {
		return Document{}, fmt.Errorf("failed to get current document title: %w", err)
	}
	currentFilePath := filepath.Join(currentFullPath, currentTitle+".md")
	// Write the historical content to current location
	newFilePath := filepath.Join(currentFullPath, historicalTitle+".md")
	if err := os.MkdirAll(currentFullPath, 0755); err != nil {
		return Document{}, fmt.Errorf("failed to create document directory: %w", err)
	}
	if err := os.WriteFile(newFilePath, []byte(historicalContent), 0644); err != nil {
		return Document{}, fmt.Errorf("failed to write historical content: %w", err)
	}

	// If title changed, update directory name and Filename
	if currentDoc.Title != historicalTitle {
		if err := os.Rename(currentFilePath, newFilePath); err != nil {
			return Document{}, fmt.Errorf("failed to rename document title: %w", err)
		}
		newID := gs.generateID(currentFullPath, historicalTitle)
		newFullPath := filepath.Join(filepath.Dir(currentFullPath), newID)
		if err := os.Rename(currentFullPath, newFullPath); err != nil {
			return Document{}, fmt.Errorf("failed to rename document directory: %w", err)
		}
		currentFullPath = newFullPath
		currentPath = path.Join(filepath.Dir(currentPath), newID)
	}

	// Commit the changes
	commitMessage := fmt.Sprintf("Restore document %s to state from commit %s (original path: %s)",
		currentPath, commitID, originalPath)
	if err := gs.commitChanges(commitMessage); err != nil {
		return Document{}, fmt.Errorf("failed to commit restoration: %w", err)
	}

	// Get the updated document with children
	restoredDoc, err := gs.GetDocument(currentPath)
	if err != nil {
		return Document{}, fmt.Errorf("failed to get restored document: %w", err)
	}

	return restoredDoc, nil
}
