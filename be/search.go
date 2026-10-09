// search.go
package main

import (
	"path"
	"regexp"
	"sort"
	"strings"
	"sync"

	"github.com/kljensen/snowball"
)

// tokenize extracts words (letters/digits) and lowercases them — markdown
// markup (#, *, `, brackets) never reaches the index.
var wordRe = regexp.MustCompile(`[\p{L}\p{N}]+`)

func tokenize(text string) []string {
	return wordRe.FindAllString(strings.ToLower(text), -1)
}

type SearchEngine struct {
	index     map[string]map[string]int
	documents map[string]Document
	mu        sync.RWMutex
	languages map[string]bool
	stemmer   func(string, string, bool) (string, error)
}

func NewSearchEngine(languages []string) *SearchEngine {
	langMap := make(map[string]bool)
	for _, lang := range languages {
		langMap[lang] = true
	}

	return &SearchEngine{
		index:     make(map[string]map[string]int),
		documents: make(map[string]Document),
		languages: langMap,
		stemmer:   snowball.Stem,
	}
}

func (se *SearchEngine) IndexDocument(doc Document) error {
	se.mu.Lock()
	defer se.mu.Unlock()

	fullPath := doc.Path
	se.documents[fullPath] = doc

	words := tokenize(doc.Title + " " + doc.Content)

	for _, word := range words {
		for lang := range se.languages {
			stemmed, err := se.stemmer(word, lang, false)
			if err == nil && stemmed != "" {
				if se.index[stemmed] == nil {
					se.index[stemmed] = make(map[string]int)
				}
				se.index[stemmed][fullPath]++
			}
		}
	}

	return nil
}

// Search returns paginated search results.
// query - search query
// page - page number (starting from 1)
// pageSize - number of results per page
func (se *SearchEngine) Search(query string, page, pageSize int) ([]Document, int, error) {
	se.mu.RLock()
	defer se.mu.RUnlock()

	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 10
	}

	queryWords := tokenize(query)
	results := make(map[string]int)

	for _, word := range queryWords {
		for lang := range se.languages {
			stemmed, err := se.stemmer(word, lang, false)
			if err != nil || stemmed == "" {
				continue
			}

			if docs, ok := se.index[stemmed]; ok {
				for docPath, count := range docs {
					results[docPath] += count
				}
			}
		}
	}

	var sortedResults []struct {
		Path  string
		Score int
	}

	for path, score := range results {
		sortedResults = append(sortedResults, struct {
			Path  string
			Score int
		}{path, score})
	}

	// Sort by relevance (descending), then by path (ascending).
	sort.Slice(sortedResults, func(i, j int) bool {
		if sortedResults[i].Score != sortedResults[j].Score {
			return sortedResults[i].Score > sortedResults[j].Score
		}
		return sortedResults[i].Path < sortedResults[j].Path
	})

	// Compute the total number of results.
	totalResults := len(sortedResults)

	// Compute the result range for the current page.
	start := (page - 1) * pageSize
	if start >= totalResults {
		return []Document{}, totalResults, nil
	}

	end := start + pageSize
	if end > totalResults {
		end = totalResults
	}

	// Keep only the results for the current page.
	paginatedResults := sortedResults[start:end]

	var docs []Document
	for _, result := range paginatedResults {
		if doc, ok := se.documents[result.Path]; ok {
			docs = append(docs, doc)
		}
	}

	return docs, totalResults, nil
}

func (se *SearchEngine) LoadFromStorage(storage Storage) error {
	rootDocs, err := storage.GetRootDocuments()
	if err != nil {
		return err
	}

	for _, doc := range rootDocs {
		fullDoc, err := storage.GetDocument(doc.Path)
		if err != nil {
			return err
		}

		if err := se.indexDocumentRecursive(storage, fullDoc); err != nil {
			return err
		}
	}

	return nil
}

func (se *SearchEngine) indexDocumentRecursive(storage Storage, doc Document) error {
	if err := se.IndexDocument(doc); err != nil {
		return err
	}

	for _, child := range doc.Children {
		childDoc, err := storage.GetDocument(path.Join(doc.Path, child.ID))
		if err != nil {
			return err
		}
		if err := se.indexDocumentRecursive(storage, childDoc); err != nil {
			return err
		}
	}

	return nil
}

func (se *SearchEngine) DeleteDocument(docPath string) error {
	se.mu.Lock()
	defer se.mu.Unlock()

	se.removeDocumentLocked(docPath)
	return nil
}

// DeleteSubtree removes a document and its whole subtree from the index.
func (se *SearchEngine) DeleteSubtree(docPath string) {
	se.mu.Lock()
	defer se.mu.Unlock()

	for key := range se.documents {
		if key == docPath || strings.HasPrefix(key, docPath+"/") {
			se.removeDocumentLocked(key)
		}
	}
}

// IndexTree indexes a document and all of its child documents.
func (se *SearchEngine) IndexTree(storage Storage, doc Document) error {
	return se.indexDocumentRecursive(storage, doc)
}

// removeDocumentLocked removes a document from the index. Requires se.mu held.
func (se *SearchEngine) removeDocumentLocked(fullPath string) {
	doc, ok := se.documents[fullPath]
	if !ok {
		return
	}

	words := tokenize(doc.Title + " " + doc.Content)
	for lang := range se.languages {
		for _, word := range words {
			stemmed, err := se.stemmer(word, lang, false)
			if err == nil && stemmed != "" {
				if index, ok := se.index[stemmed]; ok {
					delete(index, fullPath)
					if len(index) == 0 {
						delete(se.index, stemmed)
					}
				}
			}
		}
	}

	delete(se.documents, fullPath)
}
