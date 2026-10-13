// drafts.go
package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"time"
)

var validDraftID = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// ErrInvalidDraftID — invalid draft ID (mapped to 400 in the API).
var ErrInvalidDraftID = errors.New("invalid draft ID")

// ErrDraftNotFound — the draft file does not exist (mapped to 404 in the API).
var ErrDraftNotFound = errors.New("draft not found")

func validateDraftID(id string) error {
	if !validDraftID.MatchString(id) {
		return ErrInvalidDraftID
	}
	return nil
}

type Draft struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Content     string    `json:"content"`
	Path        string    `json:"path"`
	Attachments []string  `json:"attachments,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
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

// Dir returns the drafts storage directory (data/drafts).
func (ds *DraftStorage) Dir() string {
	return ds.draftsDir
}

func (ds *DraftStorage) GetDraft(id string) (*Draft, error) {
	if err := validateDraftID(id); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(ds.draftsDir, id+".json"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrDraftNotFound
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
	if err := validateDraftID(draft.ID); err != nil {
		return err
	}

	if draft.CreatedAt.IsZero() {
		draft.CreatedAt = time.Now()
	}

	// Skip the write (and the mtime churn) when nothing meaningful changed.
	existing, err := ds.GetDraft(draft.ID)
	if err == nil && existing.Title == draft.Title && existing.Content == draft.Content &&
		existing.Path == draft.Path && slices.Equal(existing.Attachments, draft.Attachments) {
		return nil
	}

	data, err := json.Marshal(draft)
	if err != nil {
		return err
	}

	return os.WriteFile(filepath.Join(ds.draftsDir, draft.ID+".json"), data, 0644)
}

// DeleteDraft is idempotent: deleting an already-removed draft is a success.
func (ds *DraftStorage) DeleteDraft(id string) error {
	if err := validateDraftID(id); err != nil {
		return err
	}
	// Remove the draft's attachment folder too (including an orphaned one).
	os.RemoveAll(filepath.Join(ds.draftsDir, id))
	err := os.Remove(filepath.Join(ds.draftsDir, id+".json"))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}
