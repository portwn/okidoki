// metadata.go
package main

import (
	"encoding/gob"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
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
	mu             sync.Mutex // guards access to the fields
}

func (m *Metadata) Stop() {
	if m.stopChan != nil {
		close(m.stopChan)
		m.stopChan = nil
	}
	if err := m.SaveOnDisk(); err != nil {
		log.Printf("Metadata.Stop: failed to save metadata: %v", err)
	}
}

func NewMetadata(filename string, checkPeriodMin int) (*Metadata, error) {
	filename = filepath.Join(filename, "metadata")
	md, err := loadMetadata(filename)
	if err != nil {
		return nil, err
	}

	md.checkPeriodMin = checkPeriodMin
	md.stopChan = make(chan struct{})

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
			changed := m.changedFlag
			m.mu.Unlock()

			if !changed {
				continue
			}
			if err := m.SaveOnDisk(); err != nil {
				log.Printf("Metadata.changeChecker: failed to auto-save metadata: %v", err)
			}

		case <-m.stopChan:
			return
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
			return
		}
	}
}

// RemoveFromFavoritesPrefix removes a document and its whole subtree from favorites.
func (m *Metadata) RemoveFromFavoritesPrefix(prefix string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.changedFlag = true
	kept := m.Favorites[:0]
	for _, f := range m.Favorites {
		if f.Path == prefix || strings.HasPrefix(f.Path, prefix+"/") {
			continue
		}
		kept = append(kept, f)
	}
	m.Favorites = kept
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

	// Drop any existing entry for the same document so it never duplicates,
	// then prepend it and cap the list at 5.
	kept := m.LastViewedDocs[:0]
	for _, d := range m.LastViewedDocs {
		if d != nil && d.Path == viewed.Path {
			continue
		}
		kept = append(kept, d)
	}

	m.LastViewedDocs = append([]*ShortDocument{viewed}, kept...)
	if len(m.LastViewedDocs) > 5 {
		m.LastViewedDocs = m.LastViewedDocs[:5]
	}
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
		return fmt.Errorf("failed to open file: %v", err)
	}
	defer file.Close()

	encoder := gob.NewEncoder(file)
	if err := encoder.Encode(m); err != nil {
		return fmt.Errorf("failed to encode: %v", err)
	}

	m.changedFlag = false
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
		return nil, fmt.Errorf("failed to open file: %v", err)
	}
	defer file.Close()

	decoder := gob.NewDecoder(file)
	var metadata Metadata
	if err := decoder.Decode(&metadata); err != nil {
		return nil, fmt.Errorf("failed to decode: %v", err)
	}

	metadata.Filename = filename
	return &metadata, nil
}

func init() {
	// Configure the logger to print time with milliseconds.
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
}
