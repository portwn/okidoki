// drafts.go
package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"
)

type Draft struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Content   string    `json:"content"`
	Path      string    `json:"path"`
	CreatedAt time.Time `json:"created_at"`
}

type DraftStorage struct {
	draftsDir string
}

func NewDraftStorage(baseDir string) (*DraftStorage, error) {
	draftsDir := filepath.Join(baseDir, "drafts")
	if err := os.MkdirAll(draftsDir, 0755); err != nil {
		return nil, err
	}
	return &DraftStorage{draftsDir: draftsDir}, nil
}

func (ds *DraftStorage) GetDraft(id string) (*Draft, error) {
	data, err := os.ReadFile(filepath.Join(ds.draftsDir, id+".json"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, errors.New("draft not found")
		}
		return nil, err
	}

	var draft Draft
	if err := json.Unmarshal(data, &draft); err != nil {
		return nil, err
	}

	return &draft, nil
}

func (ds *DraftStorage) GetAllDrafts() ([]Draft, error) {
	files, err := os.ReadDir(ds.draftsDir)
	if err != nil {
		return nil, err
	}

	var drafts []Draft
	for _, f := range files {
		if filepath.Ext(f.Name()) == ".json" {
			draft, err := ds.GetDraft(f.Name()[:len(f.Name())-5])
			if err != nil {
				continue // skip corrupted drafts
			}
			drafts = append(drafts, *draft)
		}
	}

	return drafts, nil
}

func (ds *DraftStorage) SetDraft(draft Draft) error {
	if draft.ID == "" {
		return errors.New("draft ID cannot be empty")
	}

	if draft.CreatedAt.IsZero() {
		draft.CreatedAt = time.Now()
	}

	data, err := json.Marshal(draft)
	if err != nil {
		return err
	}

	return os.WriteFile(filepath.Join(ds.draftsDir, draft.ID+".json"), data, 0644)
}

func (ds *DraftStorage) DeleteDraft(id string) error {
	err := os.Remove(filepath.Join(ds.draftsDir, id+".json"))
	if os.IsNotExist(err) {
		return errors.New("draft not found")
	}
	return err
}
