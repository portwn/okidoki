package main

import (
	"encoding/gob"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/pkg/errors"
)

type Metadata struct {
	LastViewedDocs []*ShortDocument
	Favorites      []*ShortDocument

	Filename       string
	checkPeriodMin int
	changedFlag    bool
	stopChan       chan struct{}
	mu             sync.Mutex // для безопасного доступа к полям
}

func (m *Metadata) Stop() {
	if m.stopChan != nil {
		close(m.stopChan)
	}
}

func NewMetadata(filename string, checkPeriodMin int) (*Metadata, error) {
	filename = filepath.Join(filename, "metadata")
	md, err := loadMetadata(filename)
	if err != nil {
		return nil, err
	}

	md.checkPeriodMin = checkPeriodMin

	// Запускаем фоновую проверку изменений
	if checkPeriodMin > 0 {
		go md.startChangeChecker()
	}

	return md, nil
}

func (m *Metadata) startChangeChecker() {
	ticker := time.NewTicker(time.Duration(m.checkPeriodMin) * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			m.mu.Lock()
			if m.changedFlag {
				if err := m.SaveOnDisk(); err != nil {
					fmt.Printf("Failed to auto-save metadata: %v\n", err)
				} else {
					m.changedFlag = false
				}
			}
			m.mu.Unlock()
		case <-m.stopChan:
			return // Завершаем горутину
		}
	}
}

func (m *Metadata) AddToFavorites(doc *ShortDocument) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, f := range m.Favorites {
		if f.Path == doc.Path {
			return
		}
	}
	m.changedFlag = true
	m.Favorites = append(m.Favorites, doc)
}

func (m *Metadata) IsFavorite(path string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, f := range m.Favorites {
		if f.Path == path {
			return true
		}
	}
	return false
}

func (m *Metadata) RemoveFromFavorites(path string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.changedFlag = true
	for i, f := range m.Favorites {
		if f.Path == path {
			copy(m.Favorites[i:], m.Favorites[i+1:])
			m.Favorites = m.Favorites[:len(m.Favorites)-1]
			break
		}
	}
}

func (m *Metadata) GetFavorites() []*ShortDocument {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.Favorites
}

func (m *Metadata) UpdateViewedMeta(viewed *ShortDocument) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.changedFlag = true

	if len(m.LastViewedDocs) < 5 {
		m.LastViewedDocs = append(m.LastViewedDocs, viewed)
		return
	}
	// Поиск существующего документа
	for i := 0; i < len(m.LastViewedDocs); i++ {
		if m.LastViewedDocs[i] != nil && m.LastViewedDocs[i].ID == viewed.ID {
			// Сдвиг элементов вправо для создания места на позиции 0
			copy(m.LastViewedDocs[1:], m.LastViewedDocs[:i])
			// Установка viewed на позицию 0
			m.LastViewedDocs[0] = viewed
			return
		}
	}

	// Если документ не найден - сдвиг вправо и добавление нового документа
	copy(m.LastViewedDocs[1:], m.LastViewedDocs[:len(m.LastViewedDocs)-1])
	m.LastViewedDocs[0] = viewed
}

func (m *Metadata) GetLastViewedDocuments() []ShortDocument {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]ShortDocument, len(m.LastViewedDocs))
	for i, d := range m.LastViewedDocs {
		out[i] = *d
	}
	return out
}

func (m *Metadata) SaveOnDisk() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	file, err := os.OpenFile(m.Filename, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		return fmt.Errorf("ошибка при открытии файла: %v", err)
	}
	defer file.Close()

	encoder := gob.NewEncoder(file)
	if err := encoder.Encode(m); err != nil {
		return fmt.Errorf("ошибка при кодировании: %v", err)
	}

	m.changedFlag = true
	return nil
}

func loadMetadata(filename string) (*Metadata, error) {
	file, err := os.Open(filename)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			if _, err := os.Create(filename); err != nil {
				return nil, fmt.Errorf("create metadata file: %v", err)
			}
			md := &Metadata{
				Filename:       filename,
				LastViewedDocs: make([]*ShortDocument, 0, 5),
			}
			if err := md.SaveOnDisk(); err != nil {
				os.Remove(filename)
				return nil, err
			}
			return md, nil
		}
		return nil, fmt.Errorf("ошибка при открытии файла: %v", err)
	}
	defer file.Close()

	decoder := gob.NewDecoder(file)
	var metadata Metadata
	if err := decoder.Decode(&metadata); err != nil {
		return nil, fmt.Errorf("ошибка при декодировании: %v", err)
	}

	metadata.Filename = filename // убедимся, что имя файла сохранилось
	return &metadata, nil
}
