// search.go
package main

import (
	"fmt"
	"path/filepath"
	"strings"
	"sync"

	"github.com/kljensen/snowball"
)

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

	fullPath := se.getBasePath(doc.Path)
	se.documents[fullPath] = doc

	content := doc.Title + " " + doc.Content
	words := strings.Fields(content)

	for _, word := range words {
		word = strings.ToLower(word)
		word = strings.Trim(word, ".,!?\"'()[]{}")

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

// Search возвращает результаты поиска с пагинацией
// query - поисковый запрос
// page - номер страницы (начиная с 1)
// pageSize - количество результатов на странице
func (se *SearchEngine) Search(query string, page, pageSize int) ([]Document, int, error) {
	se.mu.RLock()
	defer se.mu.RUnlock()

	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 10
	}

	queryWords := strings.Fields(query)
	results := make(map[string]int)

	for _, word := range queryWords {
		word = strings.ToLower(word)
		word = strings.Trim(word, ".,!?\"'()[]{}")

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

	// Сортировка по релевантности (по убыванию) и пути
	for i := 0; i < len(sortedResults); i++ {
		for j := i + 1; j < len(sortedResults); j++ {
			if sortedResults[j].Score == sortedResults[i].Score {
				if sortedResults[i].Path > sortedResults[j].Path {
					sortedResults[i], sortedResults[j] = sortedResults[j], sortedResults[i]
				}
			} else if sortedResults[j].Score > sortedResults[i].Score {
				sortedResults[i], sortedResults[j] = sortedResults[j], sortedResults[i]
			}
		}
	}

	// Вычисляем общее количество результатов
	totalResults := len(sortedResults)

	// Вычисляем диапазон результатов для текущей страницы
	start := (page - 1) * pageSize
	if start >= totalResults {
		return []Document{}, totalResults, nil
	}

	end := start + pageSize
	if end > totalResults {
		end = totalResults
	}

	// Получаем только результаты для текущей страницы
	paginatedResults := sortedResults[start:end]

	var docs []Document
	for _, result := range paginatedResults {
		if doc, ok := se.documents[result.Path]; ok {
			docs = append(docs, doc)
		}
	}

	return docs, totalResults, nil
}

func (se *SearchEngine) getBasePath(docPath string) string {
	basePath := filepath.Join("data", filepath.FromSlash(docPath))
	if docPath == "" {
		basePath = "data"
	}
	return basePath
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
		childDoc, err := storage.GetDocument(filepath.Join(doc.Path, child.ID))
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

	fullPath := se.getBasePath(docPath)

	// Проверяем существование документа
	if _, ok := se.documents[fullPath]; !ok {
		return fmt.Errorf("документ не найден по пути %q", docPath)
	}

	// Получаем содержимое документа для удаления всех его слов из индекса
	docContent := se.documents[fullPath].Title + " " + se.documents[fullPath].Content
	words := strings.Fields(docContent)

	// Удаляем слова документа из индекса для каждого языка
	for lang := range se.languages {
		for _, word := range words {
			word = strings.ToLower(word)
			word = strings.Trim(word, ".,!?\"'()[]{}")

			stemmed, err := se.stemmer(word, lang, false)
			if err == nil && stemmed != "" {
				if index, ok := se.index[stemmed]; ok {
					delete(index, fullPath)

					// Если слово больше не имеет ссылок, удаляем его из общего индекса
					if len(index) == 0 {
						delete(se.index, stemmed)
					}
				}
			}
		}
	}

	// Удаляем сам документ из карты documents
	delete(se.documents, fullPath)

	return nil
}
