// metadata.go
package main

import (
	"encoding/gob"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
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
	log.Printf("Metadata.Stop() called")
	if m.stopChan != nil {
		log.Printf("Closing stopChan")
		close(m.stopChan)
	}
	log.Printf("Metadata.Stop() completed")
}

func NewMetadata(filename string, checkPeriodMin int) (*Metadata, error) {
	log.Printf("NewMetadata: creating metadata with filename: %s, checkPeriod: %d", filename, checkPeriodMin)
	filename = filepath.Join(filename, "metadata")
	md, err := loadMetadata(filename)
	if err != nil {
		log.Printf("NewMetadata: error loading metadata: %v", err)
		return nil, err
	}

	md.checkPeriodMin = checkPeriodMin

	// Запускаем фоновую проверку изменений
	if checkPeriodMin > 0 {
		log.Printf("NewMetadata: starting background change checker with period %d minutes", checkPeriodMin)
		go md.startChangeChecker()
	}

	log.Printf("NewMetadata: metadata created successfully")
	return md, nil
}

func (m *Metadata) startChangeChecker() {
	log.Printf("Metadata.changeChecker: starting")
	defer log.Printf("Metadata.changeChecker: exiting")

	ticker := time.NewTicker(time.Duration(m.checkPeriodMin) * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			log.Printf("Metadata.changeChecker: tick received, checking for changes")
			m.mu.Lock()
			log.Printf("Metadata.changeChecker: mutex locked")

			if m.changedFlag {
				log.Printf("Metadata.changeChecker: changes detected, saving to disk")
				if err := m.SaveOnDisk(); err != nil {
					log.Printf("Metadata.changeChecker: failed to auto-save metadata: %v", err)
				} else {
					log.Printf("Metadata.changeChecker: auto-save completed successfully")
					m.changedFlag = false
				}
			} else {
				log.Printf("Metadata.changeChecker: no changes detected")
			}

			m.mu.Unlock()
			log.Printf("Metadata.changeChecker: mutex unlocked")

		case <-m.stopChan:
			log.Printf("Metadata.changeChecker: stop signal received")
			return // Завершаем горутину
		}
	}
}

func (m *Metadata) AddToFavorites(doc *ShortDocument) {
	log.Printf("Metadata.AddToFavorites: attempting to add doc with path: %s", doc.Path)

	// Добавляем информацию о caller'е для отладки
	callerInfo := getCallerInfo()
	log.Printf("Metadata.AddToFavorites: called from %s", callerInfo)

	m.mu.Lock()
	log.Printf("Metadata.AddToFavorites: mutex locked")
	defer func() {
		m.mu.Unlock()
		log.Printf("Metadata.AddToFavorites: mutex unlocked")
	}()

	for _, f := range m.Favorites {
		if f.Path == doc.Path {
			log.Printf("Metadata.AddToFavorites: document already in favorites")
			return
		}
	}

	m.changedFlag = true
	m.Favorites = append(m.Favorites, doc)
	log.Printf("Metadata.AddToFavorites: document added to favorites, total favorites: %d", len(m.Favorites))
}

func (m *Metadata) IsFavorite(path string) bool {
	log.Printf("Metadata.IsFavorite: checking path: %s", path)

	m.mu.Lock()
	log.Printf("Metadata.IsFavorite: mutex locked")
	defer func() {
		m.mu.Unlock()
		log.Printf("Metadata.IsFavorite: mutex unlocked")
	}()

	for _, f := range m.Favorites {
		if f.Path == path {
			log.Printf("Metadata.IsFavorite: path found in favorites")
			return true
		}
	}

	log.Printf("Metadata.IsFavorite: path not found in favorites")
	return false
}

func (m *Metadata) RemoveFromFavorites(path string) {
	log.Printf("Metadata.RemoveFromFavorites: attempting to remove path: %s", path)
	callerInfo := getCallerInfo()
	log.Printf("Metadata.RemoveFromFavorites: called from %s", callerInfo)

	m.mu.Lock()
	log.Printf("Metadata.RemoveFromFavorites: mutex locked")
	defer func() {
		m.mu.Unlock()
		log.Printf("Metadata.RemoveFromFavorites: mutex unlocked")
	}()

	m.changedFlag = true
	for i, f := range m.Favorites {
		if f.Path == path {
			copy(m.Favorites[i:], m.Favorites[i+1:])
			m.Favorites = m.Favorites[:len(m.Favorites)-1]
			log.Printf("Metadata.RemoveFromFavorites: path removed from favorites, remaining: %d", len(m.Favorites))
			return
		}
	}
	log.Printf("Metadata.RemoveFromFavorites: path not found in favorites")
}

func (m *Metadata) GetFavorites() []*ShortDocument {
	log.Printf("Metadata.GetFavorites: called")
	callerInfo := getCallerInfo()
	log.Printf("Metadata.GetFavorites: called from %s", callerInfo)

	m.mu.Lock()
	log.Printf("Metadata.GetFavorites: mutex locked")
	defer func() {
		m.mu.Unlock()
		log.Printf("Metadata.GetFavorites: mutex unlocked")
	}()

	log.Printf("Metadata.GetFavorites: returning %d favorites", len(m.Favorites))
	return m.Favorites
}

func (m *Metadata) UpdateViewedMeta(viewed *ShortDocument) {
	log.Printf("Metadata.UpdateViewedMeta: updating viewed meta for doc ID: %d, Path: %s", viewed.ID, viewed.Path)
	callerInfo := getCallerInfo()
	log.Printf("Metadata.UpdateViewedMeta: called from %s", callerInfo)

	m.mu.Lock()
	log.Printf("Metadata.UpdateViewedMeta: mutex locked")
	defer func() {
		m.mu.Unlock()
		log.Printf("Metadata.UpdateViewedMeta: mutex unlocked")
	}()

	m.changedFlag = true

	if len(m.LastViewedDocs) < 5 {
		m.LastViewedDocs = append(m.LastViewedDocs, viewed)
		log.Printf("Metadata.UpdateViewedMeta: added to last viewed (list size: %d)", len(m.LastViewedDocs))
		return
	}

	// Поиск существующего документа
	for i := 0; i < len(m.LastViewedDocs); i++ {
		if m.LastViewedDocs[i] != nil && m.LastViewedDocs[i].ID == viewed.ID {
			// Сдвиг элементов вправо для создания места на позиции 0
			copy(m.LastViewedDocs[1:], m.LastViewedDocs[:i])
			// Установка viewed на позицию 0
			m.LastViewedDocs[0] = viewed
			log.Printf("Metadata.UpdateViewedMeta: existing document moved to front")
			return
		}
	}

	// Если документ не найден - сдвиг вправо и добавление нового документа
	copy(m.LastViewedDocs[1:], m.LastViewedDocs[:len(m.LastViewedDocs)-1])
	m.LastViewedDocs[0] = viewed
	log.Printf("Metadata.UpdateViewedMeta: new document added to front (list size: %d)", len(m.LastViewedDocs))
}

func (m *Metadata) GetLastViewedDocuments() []ShortDocument {
	log.Printf("Metadata.GetLastViewedDocuments: called")
	callerInfo := getCallerInfo()
	log.Printf("Metadata.GetLastViewedDocuments: called from %s", callerInfo)

	m.mu.Lock()
	log.Printf("Metadata.GetLastViewedDocuments: mutex locked")
	defer func() {
		m.mu.Unlock()
		log.Printf("Metadata.GetLastViewedDocuments: mutex unlocked")
	}()

	out := make([]ShortDocument, len(m.LastViewedDocs))
	for i, d := range m.LastViewedDocs {
		out[i] = *d
	}
	log.Printf("Metadata.GetLastViewedDocuments: returning %d documents", len(out))
	return out
}

func (m *Metadata) SaveOnDisk() error {
	log.Printf("Metadata.SaveOnDisk: called")
	callerInfo := getCallerInfo()
	log.Printf("Metadata.SaveOnDisk: called from %s", callerInfo)

	m.mu.Lock()
	log.Printf("Metadata.SaveOnDisk: mutex locked")
	defer func() {
		m.mu.Unlock()
		log.Printf("Metadata.SaveOnDisk: mutex unlocked")
	}()

	log.Printf("Metadata.SaveOnDisk: opening file %s", m.Filename)
	file, err := os.OpenFile(m.Filename, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		log.Printf("Metadata.SaveOnDisk: error opening file: %v", err)
		return fmt.Errorf("ошибка при открытии файла: %v", err)
	}
	defer file.Close()

	log.Printf("Metadata.SaveOnDisk: encoding data")
	encoder := gob.NewEncoder(file)
	if err := encoder.Encode(m); err != nil {
		log.Printf("Metadata.SaveOnDisk: encoding error: %v", err)
		return fmt.Errorf("ошибка при кодировании: %v", err)
	}

	m.changedFlag = true
	log.Printf("Metadata.SaveOnDisk: completed successfully")
	return nil
}

func loadMetadata(filename string) (*Metadata, error) {
	log.Printf("loadMetadata: loading from %s", filename)

	file, err := os.Open(filename)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			log.Printf("loadMetadata: file does not exist, creating new metadata file")
			if _, err := os.Create(filename); err != nil {
				log.Printf("loadMetadata: error creating file: %v", err)
				return nil, fmt.Errorf("create metadata file: %v", err)
			}
			md := &Metadata{
				Filename:       filename,
				LastViewedDocs: make([]*ShortDocument, 0, 5),
			}
			if err := md.SaveOnDisk(); err != nil {
				os.Remove(filename)
				log.Printf("loadMetadata: error saving new metadata: %v", err)
				return nil, err
			}
			log.Printf("loadMetadata: new metadata file created successfully")
			return md, nil
		}
		log.Printf("loadMetadata: error opening file: %v", err)
		return nil, fmt.Errorf("ошибка при открытии файла: %v", err)
	}
	defer file.Close()

	log.Printf("loadMetadata: decoding existing metadata")
	decoder := gob.NewDecoder(file)
	var metadata Metadata
	if err := decoder.Decode(&metadata); err != nil {
		log.Printf("loadMetadata: decoding error: %v", err)
		return nil, fmt.Errorf("ошибка при декодировании: %v", err)
	}

	metadata.Filename = filename // убедимся, что имя файла сохранилось
	log.Printf("loadMetadata: metadata loaded successfully, favorites: %d, last viewed: %d",
		len(metadata.Favorites), len(metadata.LastViewedDocs))
	return &metadata, nil
}

// getCallerInfo возвращает информацию о caller'е для отладки
func getCallerInfo() string {
	pc, file, line, ok := runtime.Caller(2) // 2 уровня выше, чтобы пропустить саму эту функцию
	if !ok {
		return "unknown:0"
	}

	fn := runtime.FuncForPC(pc)
	funcName := "unknown"
	if fn != nil {
		funcName = fn.Name()
	}

	return fmt.Sprintf("%s:%d (%s)", filepath.Base(file), line, funcName)
}

// Добавим также функцию для установки логгера
func init() {
	// Настраиваем логгер для вывода времени и миллисекунд
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
}
