import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import RichTextEditor from './editor/RichTextEditor';
import { uploadFile, resolveAsset, configureAssets, setAttachments } from './editor/upload';
import { fetchJSON, apiFetch, apiPath } from './api';
import { useNotifications, NOTIFICATION_TYPES } from './hooks/useNotifications';
import { useI18n, getLocale, translate } from './i18n';
import { customAlphabet } from 'nanoid';
import './App.css';
// Icons from Radix UI.
import {
    MagnifyingGlassIcon,
    StarIcon,
    StarFilledIcon,
    Pencil1Icon,
    FilePlusIcon,
    Cross1Icon,
    Cross2Icon,
    CrossCircledIcon,
    CheckIcon,
    ClockIcon,
    TrashIcon,
    MoveIcon,
    DotFilledIcon,
    ChevronRightIcon,
    ChevronDownIcon,
    HomeIcon,
    GitHubLogoIcon,
    FileTextIcon,
    HamburgerMenuIcon
} from '@radix-ui/react-icons';

const nanoid = customAlphabet('1234567890abcdef', 10);

const MIN_SIDEBAR_WIDTH = 150;
const COLLAPSED_SIDEBAR_WIDTH = MIN_SIDEBAR_WIDTH / 4;

const formatDocumentDate = (dateString) => {
    if (!dateString) return translate('doc.unknownDate');

    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return String(dateString);
    const day = date.getDate();
    const month = date.toLocaleString(getLocale(), { month: 'long' });
    const year = date.getFullYear();

    return `${day} ${month} ${year}`;
};

const formatDocumentTime = (dateString) => {
    if (!dateString) return '';

    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '';
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    return `${hours}:${minutes}`;
};

const DocumentTree = ({
                          documents,
                          currentDocPath, // Accept the full path instead of the ID
                          selectedPath = null, // Highlighted move target
                          onSelect,
                          expandedNodes,
                          toggleExpand,
                          loadChildren,
                          loadingParents,
                          onCreateNewDocument,
                          showCreateButton = true,
                          showRootOption = false, // Move modal: allow moving to root
                          rootDisabled = false, // Source already at root
                      }) => {
    const { t } = useI18n();
    const renderDocuments = (docs, parentPath = []) => {
        if (!docs) return null;

        return docs.map(doc => {
            const path = [...parentPath, doc.id];
            const pathKey = path.join('-');
            const isExpanded = expandedNodes[pathKey];
            const isLoading = loadingParents[pathKey];
            const docFullPath = path.join('/');
            const isActive = currentDocPath === docFullPath;
            const isSelected = selectedPath !== null && docFullPath === selectedPath;

            return (
                <div key={doc.id} style={{ marginLeft: `${(path.length - 1) * 15}px` }}>
                    <div
                        className={`document-item${isActive ? ' active' : ''}${isSelected ? ' selected' : ''}`}
                        onClick={() => onSelect(doc.id, path)}
                    >
                    <span
                        className="icon"
                        onClick={async (e) => {
                            e.stopPropagation();
                            const newExpandedState = !isExpanded;
                            toggleExpand(path);

                            if (newExpandedState && doc.hasChildren && !doc.children) {
                                await loadChildren(doc.id, path);
                            }
                        }}
                    >
                        {isLoading ? <span className="spinner" /> : doc.hasChildren ? (isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />) : <DotFilledIcon />}
                    </span>
                        <span className={`document-title ${isActive ? 'active' : ''}`}>
                        {doc.title}
                    </span>
                    </div>
                    {isExpanded && doc.children && (
                        <div className="children-container">
                            {renderDocuments(doc.children, path)}
                        </div>
                    )}
                </div>
            );
        });
    };

    return (
        <div className="document-tree">
            {showCreateButton && (
                <div
                    className="new-document-button"
                    onClick={() => onCreateNewDocument()}
                >
                    <FilePlusIcon /> {t('common.newDocument')}
                </div>
            )}
            {showRootOption && (
                <div
                    className={`document-item root-item${selectedPath === '' ? ' selected' : ''}${rootDisabled ? ' disabled' : ''}`}
                    onClick={() => {
                        if (!rootDisabled) onSelect('', []);
                    }}
                >
                    <span className="icon"><HomeIcon /></span>
                    <span className="document-title">{t('move.root')}</span>
                </div>
            )}
            {renderDocuments(documents)}
        </div>
    );
};

const HistoryList = ({ history, selectedCommit, onSelect }) => {
    const { t } = useI18n();
    return (
        <div className="history-list">
            <h3>{t('history.title')}</h3>
            {history.map((commit) => (
                <div
                    key={commit.commitHash}
                    className={`history-item ${selectedCommit === commit.commitHash ? 'selected' : ''}`}
                    onClick={() => onSelect(commit.commitHash)}
                >
                    <div className="commit-message">{commit.message || t('history.noCommitMessage')}</div>
                    <div className="commit-date">{formatDocumentDate(commit.date)}
                        <span className="time-part">, {formatDocumentTime(commit.date)}</span>
                    </div>
                    <div className="commit-stats">
                        <span className="added">+{commit.added || 0}</span>
                        <span className="deleted">-{commit.deleted || 0}</span>
                    </div>
                </div>
            ))}
        </div>
    );
};

const SearchResultsView = ({ results, currentPage, totalPages, onPageChange, onSelect, query }) => {
    const { t } = useI18n();
    return (
        <div className="search-results-container">
            <h2>{t('search.resultsFor', { query })}</h2>
            {results.length === 0 ? (
                <p>{t('search.noResults')}</p>
            ) : (
                <>
                    <div className="results-list">
                        {results.map((doc, index) => (
                            <div key={doc.id} className="search-result-item">
                                <div className="result-number">{(currentPage - 1) * 10 + index + 1}.</div>
                                <div className="result-content">
                                    <h3
                                        className="result-title"
                                        onClick={() => onSelect(doc.path)}
                                    >
                                        {doc.title}
                                    </h3>
                                    <div className="result-snippet">
                                        {doc.content.substring(0, 150)}...
                                    </div>
                                    <div className="result-path">{doc.path}</div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {totalPages > 1 && (
                        <div className="pagination">
                            {currentPage > 1 && (
                                <button
                                    onClick={() => onPageChange(currentPage - 1)}
                                    className="pagination-button"
                                >
                                    {t('search.previous')}
                                </button>
                            )}

                            <span className="page-info">
                                {t('search.pageOf', { page: currentPage, total: totalPages })}
                            </span>

                            {currentPage < totalPages && (
                                <button
                                    onClick={() => onPageChange(currentPage + 1)}
                                    className="pagination-button"
                                >
                                    {t('search.next')}
                                </button>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

const DraftsSection = ({ drafts, expanded, onToggle, loading, onDraftClick, onDeleteDraft }) => {
    const { t } = useI18n();
    const handleDelete = (e, draftId) => {
        e.stopPropagation(); // Prevent the draft click from firing.
        if (window.confirm(t('confirm.deleteDraft'))) {
            onDeleteDraft(draftId);
        }
    };

    return (
        <div className="section-container drafts-section">
            <div className="section-header" onClick={onToggle}>
                <h3><FileTextIcon className="section-icon" /> {t('sections.drafts')}</h3>
                <span className="toggle-icon">{expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}</span>
            </div>
            {expanded && (
                <div className="section-content">
                    {loading ? (
                        <div className="loading">{t('loading.drafts')}</div>
                    ) : drafts.length === 0 ? (
                        <div className="empty-section">{t('sections.noDrafts')}</div>
                    ) : (
                        drafts.map(draft => (
                            <div
                                key={draft.id}
                                className="section-item"
                                onClick={() => onDraftClick(draft.id)}
                            >
                                <div className="section-item-main">
                                    <div className="section-title">{draft.title || t('sections.untitledDraft')}</div>
                                    {draft.path && (
                                        <div className="section-path">
                                            <span className="path-label">{t('sections.path')}</span> {draft.path}
                                        </div>
                                    )}
                                    <div className="section-date">{formatDocumentDate(draft.created_at)}
                                        <span className="time-part">, {formatDocumentTime(draft.created_at)}</span>
                                    </div>
                                </div>
                                <span
                                    className="section-action"
                                    onClick={(e) => handleDelete(e, draft.id)}
                                    title={t('sections.deleteDraft')}
                                    role="button"
                                    aria-label={t('sections.deleteDraft')}
                                >
                                    <TrashIcon />
                                </span>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

const LastDocumentsSection = ({
                                  documents,
                                  loading,
                                  onSelect,
                                  expanded,
                                  onToggle
                              }) => {
    const { t } = useI18n();
    return (
        <div className="section-container last-documents-section">
            <div className="section-header" onClick={onToggle}>
                <h3><ClockIcon className="section-icon" /> {t('sections.lastViewed')}</h3>
                <span className="toggle-icon">{expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}</span>
            </div>
            {expanded && (
                <div className="section-content">
                    {loading ? (
                        <div className="loading">{t('loading.last')}</div>
                    ) : documents.length === 0 ? (
                        <div className="empty-section">{t('sections.noRecent')}</div>
                    ) : (
                        documents.map(doc => (
                            <div
                                key={doc.id}
                                className="section-item"
                                onClick={() => onSelect(doc.path)}
                            >
                                <div className="section-item-main">
                                    <div className="section-title">{doc.title}</div>
                                    {doc.path && (
                                        <div className="section-path">{doc.path}</div>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

const FavoritesSection = ({
                              documents,
                              loading,
                              onSelect,
                              expanded,
                              onToggle,
                              onToggleFavorite
                          }) => {
    const { t } = useI18n();
    const handleToggleFavorite = (e, path) => {
        e.stopPropagation();
        onToggleFavorite(path);
    };

    return (
        <div className="section-container favorites-section">
            <div className="section-header" onClick={onToggle}>
                <h3><StarFilledIcon className="section-icon" /> {t('sections.favorites')}</h3>
                <span className="toggle-icon">{expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}</span>
            </div>
            {expanded && (
                <div className="section-content">
                    {loading ? (
                        <div className="loading">{t('loading.favorites')}</div>
                    ) : documents.length === 0 ? (
                        <div className="empty-section">{t('sections.noFavorites')}</div>
                    ) : (
                        documents.map(doc => (
                            <div
                                key={doc.id}
                                className="section-item"
                                onClick={() => onSelect(doc.path)}
                            >
                                <div className="section-item-main">
                                    <div className="section-title">{doc.title}</div>
                                    {doc.path && (
                                        <div className="section-path">{doc.path}</div>
                                    )}
                                </div>
                                <span
                                    className="section-action"
                                    onClick={(e) => handleToggleFavorite(e, doc.path)}
                                    title={t('sections.removeFavorite')}
                                    role="button"
                                    aria-label={t('sections.removeFavorite')}
                                >
                                    <StarFilledIcon />
                                </span>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

// The set of root-page sections. On desktop "last/favorites" and "drafts"
// are split into two columns; on mobile they stack.
const RootSections = ({
    lastDocuments, lastDocumentsLoading, lastDocumentsExpanded, onToggleLast,
    favorites, favoritesLoading, favoritesExpanded, onToggleFavorites,
    drafts, draftsExpanded, onToggleDrafts, draftsLoading, grouped,
    onSelect, onToggleFavorite, onDraftClick, onDeleteDraft,
}) => {
    const last = (
        <LastDocumentsSection
            documents={lastDocuments}
            loading={lastDocumentsLoading}
            onSelect={onSelect}
            expanded={lastDocumentsExpanded}
            onToggle={onToggleLast}
        />
    );
    const fav = (
        <FavoritesSection
            documents={favorites || []}
            loading={favoritesLoading}
            onSelect={onSelect}
            expanded={favoritesExpanded}
            onToggle={onToggleFavorites}
            onToggleFavorite={onToggleFavorite}
        />
    );
    const draftsEl = (
        <DraftsSection
            drafts={drafts}
            expanded={draftsExpanded}
            onToggle={onToggleDrafts}
            loading={draftsLoading}
            onDraftClick={onDraftClick}
            onDeleteDraft={onDeleteDraft}
        />
    );

    if (grouped) {
        return (
            <>
                <div>{last}{fav}</div>
                <div>{draftsEl}</div>
            </>
        );
    }
    return <>{last}{fav}{draftsEl}</>;
};

const NotificationPopup = ({ notifications, onClose }) => {
    const { t } = useI18n();
    const [exitingIds, setExitingIds] = useState([]);

    const handleClose = (id) => {
        setExitingIds(prev => [...prev, id]);
        setTimeout(() => {
            onClose(id);
            setExitingIds(prev => prev.filter(i => i !== id));
        }, 300);
    };

    if (notifications.length === 0) return null;

    return (
        <div className="notification-popup-container">
            {notifications.map((notification) => (
                <div
                    key={notification.id}
                    className={`notification-popup ${notification.type} ${exitingIds.includes(notification.id) ? 'exiting' : ''}`}
                >
                    <div className="notification-content">
                        <span className="notification-message">{notification.message}</span>
                        <button
                            className="notification-close"
                            onClick={() => handleClose(notification.id)}
                            aria-label={t('common.close')}
                        >
                            <Cross2Icon />
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
};

function App() {
    const { t } = useI18n();
    const savedSidebarWidth = parseInt(localStorage.getItem('sidebarWidth')) || MIN_SIDEBAR_WIDTH;
    const savedSidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';

    const [sidebarWidth, setSidebarWidth] = useState(savedSidebarWidth);
    const [prevSidebarWidth, setPrevSidebarWidth] = useState(savedSidebarWidth);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(savedSidebarCollapsed);
    const [isDragging, setIsDragging] = useState(false);
    const [expandedNodes, setExpandedNodes] = useState({});
    const [loadingParents, setLoadingParents] = useState({});
    const [searchQuery, setSearchQuery] = useState('');
    const [showMenu, setShowMenu] = useState(false);
    const [documents, setDocuments] = useState([]);
    const [currentDocument, setCurrentDocument] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const { notifications, addNotification, removeNotification } = useNotifications();
    const [editMode, setEditMode] = useState(false);
    const [createMode, setCreateMode] = useState(false);
    const [editedTitle, setEditedTitle] = useState('');
    const [markdown, setMarkdown] = useState('');
    const [showMoveModal, setShowMoveModal] = useState(false);
    const [moveTargetId, setMoveTargetId] = useState(null);
    const [searchResults, setSearchResults] = useState(null);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchError, setSearchError] = useState(null);
    const [historyMode, setHistoryMode] = useState(false);
    const [documentHistory, setDocumentHistory] = useState([]);
    const [historicalDocument, setHistoricalDocument] = useState(null);
    const [selectedHistoryCommit, setSelectedHistoryCommit] = useState(null);
    const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
    const [saveStatus, setSaveStatus] = useState(null);
    const [lastSavedTime, setLastSavedTime] = useState(0);

    const { '*': docPath } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const menuRef = useRef(null);
    const editorRef = useRef(null);
    const docPathRef = useRef('');
    const draftIdRef = useRef(null);
    const docRequestRef = useRef(0);
    const relatedRequestRef = useRef(0);
    const draftRequestRef = useRef(0);
    const searchRequestRef = useRef(0);
    const historyRequestRef = useRef(0);
    const lastLoadRef = useRef(null);
    const saveStatusTimerRef = useRef(null);

    // Push the current path/draft into the attachments client (resolveAsset).
    useEffect(() => {
        docPathRef.current = currentDocument?.path || docPath || '';
    }, [currentDocument, docPath]);

    useEffect(() => {
        configureAssets({
            getDocPath: () => docPathRef.current,
            getDraftId: () => draftIdRef.current,
        });
    }, []);

    const [draftId, setDraftId] = useState(null);
    const [prevTitle, setPrevTitle] = useState('');
    const [prevContent, setPrevContent] = useState('');
    // Parent folder for the document being created (sidebar -> '', header -> current doc).
    const [createParentPath, setCreateParentPath] = useState('');

    useEffect(() => {
        draftIdRef.current = draftId;
    }, [draftId]);

    // Mobile states
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
    const [showMobileMenu, setShowMobileMenu] = useState(false);

    // Additional App component state.
    const [drafts, setDrafts] = useState([]);
    const [draftsExpanded, setDraftsExpanded] = useState(true);
    const [draftsLoading, setDraftsLoading] = useState(false);

    // Additional state.
    const [lastDocuments, setLastDocuments] = useState([]);
    const [lastDocumentsLoading, setLastDocumentsLoading] = useState(false);
    const [lastDocumentsExpanded, setLastDocumentsExpanded] = useState(true);

    const [favorites, setFavorites] = useState(null);
    const [favoritesLoading, setFavoritesLoading] = useState(false);
    const [favoritesExpanded, setFavoritesExpanded] = useState(true);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setShowMenu(false);
            }
        };

        if (showMenu) {
            document.addEventListener('mousedown', handleClickOutside);
        } else {
            document.removeEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showMenu]);

    useEffect(() => {
        // Edit mode.
        if (editMode && currentDocument) {
            document.title = `*${currentDocument.title}`;
            return;
        }

        // Create mode.
        if (createMode) {
            document.title = draftId ? '*Draft' : t('editor.createNewDocument');
            return;
        }

        // Search results.
        if (searchResults) {
            const query = searchParams.get('q') || '';
            document.title = t('search.windowTitle', { query });
            return;
        }

        // Document view.
        if (currentDocument) {
            document.title = `${currentDocument.title}`;
            return;
        }

        // Default.
        document.title = 'Okidoki';
    }, [
        currentDocument,
        editMode,
        createMode,
        searchResults,
        searchParams,
        draftId,
        t
    ]);

    // Shows the save status, resetting the previous timer (an outdated
    // timer would otherwise clear a fresh status).
    const flashSaveStatus = useCallback((status) => {
        if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
        setSaveStatus(status);
        saveStatusTimerRef.current = setTimeout(() => {
            saveStatusTimerRef.current = null;
            setSaveStatus(null);
        }, 2000);
    }, []);

    useEffect(() => () => {
        if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    }, []);

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth <= 768);
            if (window.innerWidth > 768) {
                setShowMobileMenu(false);
            }
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        const query = searchParams.get('q');
        const page = parseInt(searchParams.get('page')) || 1;

        if (query) {
            performSearch(query, page);
        } else {
            setSearchResults(null);
        }
    }, [searchParams]);



    const saveDocumentDraft = useCallback(async () => {
        if (!currentDocument) return;

        try {
            await fetchJSON(`/api/document/${apiPath(currentDocument.path)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: editedTitle,
                    content: markdown,
                    commit_changes: false
                })
            });

            return true;
        } catch (err) {
            console.error('Error saving draft:', err);
            throw err;
        }
    }, [currentDocument, editedTitle, markdown]);

    // Auto-save draft effect
    useEffect(() => {
        if (!editMode || !currentDocument) return;

        const handleAutoSave = async () => {
            const now = Date.now();
            if (now - lastSavedTime < 5000) return;

            // Check whether there were changes.
            const hasChanges = editedTitle !== prevTitle || markdown !== prevContent;
            if (!hasChanges) return;

            try {
                await saveDocumentDraft();
                flashSaveStatus('success');
                setLastSavedTime(now);
                // Update the previous values after saving.
                setPrevTitle(editedTitle);
                setPrevContent(markdown);
            } catch (err) {
                flashSaveStatus('error');
                console.error('Auto-save failed:', err);
            }
        };

        const timer = setTimeout(handleAutoSave, 5000);

        return () => {
            clearTimeout(timer);
        };
    }, [editMode, markdown, editedTitle, currentDocument, lastSavedTime, saveDocumentDraft, prevTitle, prevContent, flashSaveStatus]);

    const saveCreateDraft = useCallback(async () => {
        try {
            const draftIdToSave = draftId || nanoid();

            await fetchJSON('/api/draft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: draftIdToSave,
                    title: editedTitle,
                    content: markdown,
                    path: createParentPath
                })
            });

            if (!draftId) {
                setDraftId(draftIdToSave);
            }

            return true;
        } catch (err) {
            addNotification(err.message);
            throw err;
        }
    }, [draftId, editedTitle, markdown, createParentPath, addNotification]);

    useEffect(() => {
        if (!createMode) return;

        const handleAutoSave = async () => {
            const now = Date.now();
            if (now - lastSavedTime < 5000) return;

            // Check whether there were changes.
            const hasChanges = editedTitle !== prevTitle || markdown !== prevContent;
            if (!hasChanges) return;

            try {
                // If there is no draftId yet, save as a new draft.
                await saveCreateDraft();

                flashSaveStatus('success');
                setLastSavedTime(now);
                // Update the previous values after saving.
                setPrevTitle(editedTitle);
                setPrevContent(markdown);
            } catch (err) {
                flashSaveStatus('error');
                console.error('Auto-save failed:', err);
            }
        };

        const timer = setTimeout(handleAutoSave, 5000);

        return () => {
            clearTimeout(timer);
        };
    }, [createMode, markdown, editedTitle, lastSavedTime, saveCreateDraft, prevTitle, prevContent, flashSaveStatus]);

    const performSearch = async (query, page = 1) => {
        const reqId = ++searchRequestRef.current;
        try {
            setSearchLoading(true);
            setSearchError(null);

            const data = await fetchJSON(`/api/search?q=${encodeURIComponent(query)}&page=${page}&pageSize=10`);
            if (reqId !== searchRequestRef.current) return;
            setSearchResults(data);
        } catch (err) {
            if (reqId === searchRequestRef.current) setSearchError(err.message);
        } finally {
            if (reqId === searchRequestRef.current) setSearchLoading(false);
        }
    };

    const SaveStatusIndicator = ({ status }) => {
        const { t: tr } = useI18n();
        if (!status) return null;

        return (
            <div className={`save-status ${status === 'success' ? 'success' : 'error'}`}>
                {status === 'success' ? (
                    <>
                        <span className="save-icon"><CheckIcon /></span> {tr('status.saved')}
                    </>
                ) : (
                    <>
                        <span className="save-icon"><CrossCircledIcon /></span> {tr('status.saveError')}
                    </>
                )}
            </div>
        );
    };

    const navigateToDocumentPath = useCallback((pathSegments) => {
        const normalizedPath = pathSegments.join('/');
        navigate(`/doc/${normalizedPath}`);
    }, [navigate]);

    const toggleSidebar = () => {
        if (isMobile) {
            setShowMobileMenu(!showMobileMenu);
        } else {
            if (isSidebarCollapsed) {
                setIsSidebarCollapsed(false);
                setSidebarWidth(prevSidebarWidth);
            } else {
                setPrevSidebarWidth(sidebarWidth);
                setIsSidebarCollapsed(true);
                setSidebarWidth(COLLAPSED_SIDEBAR_WIDTH);
            }
        }
    };

    const handleSidebarClick = (e) => {
        if (isSidebarCollapsed && !isMobile) {
            toggleSidebar();
        }
    };

    const loadChildren = useCallback(async (parentId, path) => {
        const pathKey = path.join('-');
        try {
            setLoadingParents(prev => ({ ...prev, [pathKey]: true }));

            const parentPath = path.join('/');
            const children = await fetchJSON(`/api/documents/${apiPath(parentPath)}`);

            setDocuments(prevDocs => {
                const updateChildren = (docs) => {
                    return docs.map(doc => {
                        if (doc.id === parentId) {
                            return { ...doc, children };
                        }
                        if (doc.children) {
                            return { ...doc, children: updateChildren(doc.children) };
                        }
                        return doc;
                    });
                };
                return updateChildren(prevDocs);
            });
        } catch (err) {
            addNotification(err.message);
        } finally {
            setLoadingParents(prev => ({ ...prev, [pathKey]: false }));
        }
    }, [addNotification]);

    const fetchRelatedDocuments = useCallback(async (docPath) => {
        const reqId = ++relatedRequestRef.current;
        try {
            setIsLoading(true);
            const endpoint = docPath ? `/api/related/${apiPath(docPath)}` : '/api/documents';
            const rawData = await fetchJSON(endpoint);
            if (reqId !== relatedRequestRef.current) return null;
            const data = docPath ? rawData : { root: rawData };

            // Build a fresh expandedNodes keeping only the root node.
            const newExpandedNodes = { 'root': true };

            // With a docPath, expand the path to the current document.
            if (docPath) {
                const pathParts = docPath.split('/');
                let currentPath = [];

                for (let i = 0; i < pathParts.length; i++) {
                    currentPath.push(pathParts[i]);
                    const pathKey = currentPath.join('-');
                    newExpandedNodes[pathKey] = true;
                }
            }

            setExpandedNodes(newExpandedNodes);

            const buildTree = (path, docs) => {
                if (path === 'root') {
                    return docs;
                }

                const pathParts = path.split('/');
                let currentLevel = data.root;

                for (let i = 0; i < pathParts.length; i++) {
                    const part = pathParts[i];
                    const found = currentLevel.find(d => d.id === part);
                    if (found) {
                        if (i === pathParts.length - 1) {
                            found.children = docs;
                        } else {
                            currentLevel = found.children || [];
                        }
                    }
                }

                return data.root;
            };

            const mergedTree = Object.entries(data).reduce((acc, [path, docs]) => {
                return buildTree(path, docs);
            }, []);

            setDocuments(mergedTree);
            return mergedTree;
        } catch (err) {
            if (reqId === relatedRequestRef.current) addNotification(err.message);
            return null;
        } finally {
            if (reqId === relatedRequestRef.current) setIsLoading(false);
        }
    }, [addNotification]);

    const fetchDraft = useCallback(async (draftId) => {
        const reqId = ++draftRequestRef.current;
        try {
            setIsLoading(true);
            const draft = await fetchJSON(`/api/draft/${apiPath(draftId)}`);
            if (reqId !== draftRequestRef.current) return;

            setEditedTitle(draft.title);
            setMarkdown(draft.content);
            setPrevTitle(draft.title);
            setPrevContent(draft.content);
            setAttachments(draft.attachments || []);
            setDraftId(draftId);
            setCreateParentPath(draft.path || '');
            setCreateMode(true);
            setCurrentDocument(null);
        } catch (err) {
            if (reqId === draftRequestRef.current) {
                addNotification(err.message === 'draft not found' ? t('notify.draftNotFound') : err.message);
            }
        } finally {
            if (reqId === draftRequestRef.current) setIsLoading(false);
        }
    }, [addNotification, t]);

    const fetchDocument = useCallback(async (pathSegments) => {
        const reqId = ++docRequestRef.current;
        try {
            setIsLoading(true);
            const path = pathSegments.join('/');

            const doc = await fetchJSON(`/api/document/${apiPath(path)}`);

            // Ignore a stale response if we have already navigated elsewhere.
            if (reqId !== docRequestRef.current) return null;

            setCurrentDocument(doc);
            setMarkdown(doc.content || '');
            setPrevTitle(doc.title);
            setPrevContent(doc.content || '');
            setAttachments(doc.attachments || []);

            return doc;
        } catch (err) {
            if (reqId === docRequestRef.current) addNotification(err.message);
            return null;
        } finally {
            if (reqId === docRequestRef.current) setIsLoading(false);
        }
    }, [addNotification]);

    const saveDocument = useCallback(async () => {
        try {
            setIsLoading(true);
            // Check whether there are changes OR the document has uncommitted: true.
            const hasChanges = editedTitle !== prevTitle || markdown !== prevContent;
            const needsSave = hasChanges || currentDocument?.uncommitted;

            if (!needsSave) {
                setEditMode(false);
                setIsLoading(false);
                return;
            }

            const updatedDoc = await fetchJSON(`/api/document/${apiPath(currentDocument.path)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: editedTitle,
                    content: markdown,
                    commit_changes: true
                })
            });

            setCurrentDocument(updatedDoc);
            setEditMode(false);
            flashSaveStatus('success');
            // Update the previous values after saving.
            setPrevTitle(editedTitle);
            setPrevContent(markdown);

            await fetchRelatedDocuments(updatedDoc.path);
            navigateToDocumentPath(updatedDoc.path.split('/'));
        } catch (err) {
            addNotification(err.message);
            flashSaveStatus('error');
        } finally {
            setIsLoading(false);
        }
    }, [currentDocument, editedTitle, markdown, prevTitle, prevContent, fetchRelatedDocuments, navigateToDocumentPath, addNotification, flashSaveStatus]);

    // Load drafts.
    const fetchDrafts = useCallback(async () => {
        try {
            setDraftsLoading(true);
            const data = await fetchJSON('/api/drafts');
            setDrafts(data);
        } catch (err) {
            addNotification(err.message);
        } finally {
            setDraftsLoading(false);
        }
    }, [addNotification]);

    const deleteDraft = useCallback(async (draftId) => {
        if (!draftId) return;

        try {
            await fetchJSON(`/api/draft/${apiPath(draftId)}`, {
                method: 'DELETE'
            });

            // Refresh the draft list after deletion.
            await fetchDrafts();
            flashSaveStatus('success');
        } catch (err) {
            addNotification(err.message);
            flashSaveStatus('error');
        }
    }, [fetchDrafts, addNotification, flashSaveStatus]);

    const handleDeleteDraftClick = useCallback(async () => {
        const id = draftIdRef.current;
        if (!id || !window.confirm(t('confirm.deleteDraft'))) return;

        setShowMenu(false);
        await deleteDraft(id);

        // The draft is gone — leave the create flow.
        setCreateMode(false);
        setDraftId(null);
        setCreateParentPath('');
        setEditedTitle('');
        setPrevTitle('');
        setMarkdown('');
        setPrevContent('');
        setAttachments([]);
        setCurrentDocument(null);
        navigate('/', { replace: true });
    }, [deleteDraft, navigate, t]);

    const createDocument = useCallback(async () => {
        try {
            setIsLoading(true);

            // The parent is fixed when the create flow started (root or current doc).
            const parentPath = createParentPath;

            let url = '/api/document';
            const body = {
                title: editedTitle || t('common.newDocument'),
                content: markdown
            };

            // Add parentPath only when present.
            if (parentPath) {
                body.parentPath = parentPath;
            }

            // If the draft exists, add its ID to the request.
            if (draftId) {
                url += `?draft=${encodeURIComponent(draftId)}`;
            }

            const response = await apiFetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (response.status === 202) {
                addNotification(t('notify.parentNotFound'), NOTIFICATION_TYPES.WARNING);
            }

            const newDoc = await response.json();

            navigateToDocumentPath(newDoc.path.split('/'));
            setCurrentDocument(newDoc);
            setAttachments(newDoc.attachments || []);
            setCreateMode(false);
            setDraftId(null);
            setCreateParentPath('');

            if (parentPath) {
                const pathKey = parentPath.split('/').join('-');
                setExpandedNodes(prev => ({
                    ...prev,
                    [pathKey]: true
                }));
            }
        } catch (err) {
            addNotification(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [draftId, editedTitle, markdown, createParentPath, navigateToDocumentPath, addNotification, t]);

    // Ctrl/Cmd+S — save the current document or create a new one.
    // Always swallowed: outside edit/create modes there is nothing to save,
    // and the browser's "save page" dialog is never wanted here.
    useEffect(() => {
        const onKeyDown = (e) => {
            if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
            if (e.key.toLowerCase() !== 's') return;
            e.preventDefault();
            if (editMode) {
                saveDocument();
            } else if (createMode) {
                createDocument();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [editMode, createMode, saveDocument, createDocument]);

    // Tab in the title moves the caret into the beginning of the document body.
    const handleTitleKeyDown = useCallback((e) => {
        if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        editorRef.current?.focusStart?.();
    }, []);

    // Pressing ArrowUp at the very start of the document scrolls the area up
    // to bring the title back while staying in the editor.
    const handleEditorKeyDown = useCallback((e) => {
        if (e.key !== 'ArrowUp') return;
        const editor = editorRef.current?.getEditor?.();
        const atStart = !editor || (editor.state.selection.empty && editor.state.selection.from <= 1);
        if (!atStart) return;
        // At the start of the document align the inner scroll, otherwise the top padding
        // (between the toolbar and the first line) stays hidden.
        const inner = e.currentTarget.querySelector('.rte-editor');
        if (inner && inner.scrollTop > 0) inner.scrollTop = 0;
        const container = e.currentTarget.closest('.edit-container');
        if (!container || container.scrollTop <= 0) return;
        e.preventDefault();
        container.scrollTop = Math.max(0, container.scrollTop - 48);
    }, []);

    const deleteDocument = useCallback(async (recursive = false) => {
        if (!currentDocument) return;

        try {
            setIsLoading(true);
            const parentPath = currentDocument.path.split('/').slice(0, -1).join('/');

            const url = recursive
                ? `/api/document/${apiPath(currentDocument.path)}?recursive=true`
                : `/api/document/${apiPath(currentDocument.path)}`;

            await fetchJSON(url, { method: 'DELETE' });

            await fetchRelatedDocuments(parentPath || '');

            if (parentPath) {
                navigateToDocumentPath(parentPath.split('/'));
            } else {
                navigate('/');
            }

            setCurrentDocument(null);
            setShowMenu(false);
        } catch (err) {
            addNotification(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [currentDocument, navigate, navigateToDocumentPath, fetchRelatedDocuments, addNotification]);

    const moveDocument = useCallback(async (targetPath) => {
        if (!currentDocument || targetPath === null || targetPath === undefined) return;

        try {
            setIsLoading(true);
            const moved = await fetchJSON(`/api/document/${apiPath(currentDocument.path)}/move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetPath })
            });

            setShowMoveModal(false);
            setShowMenu(false);
            setMoveTargetId(null);

            await fetchRelatedDocuments(targetPath || '');
            navigateToDocumentPath(moved.path.split('/'));
            setCurrentDocument(moved);
        } catch (err) {
            addNotification(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [currentDocument, navigateToDocumentPath, fetchRelatedDocuments, addNotification]);

    const startCreateNewDocument = useCallback((parentPath = '') => {
        // Generate the id immediately so attachments can target the draft staging folder.
        setDraftId(nanoid());
        setEditedTitle('');
        setPrevTitle('');
        setMarkdown('');
        setPrevContent('');
        setAttachments([]);
        setCreateParentPath(parentPath);
        setCreateMode(true);
        setCurrentDocument(null);
        setShowMobileMenu(false);
        editorRef.current?.clearSelection();
    }, []);

    const cancelCreate = useCallback(() => {
        const id = draftIdRef.current;
        if (id) {
            // The draft may have been auto-saved — delete it on the server; errors do not matter.
            fetchJSON(`/api/draft/${apiPath(id)}`, { method: 'DELETE' }).catch(() => {});
        }
        setCreateMode(false);
        setDraftId(null);
        setCreateParentPath('');
        if (docPath) {
            fetchDocument(docPath.split('/'));
        } else {
            setCurrentDocument(null);
        }
    }, [docPath, fetchDocument]);

    const toggleExpand = useCallback((path) => {
        const pathKey = path.join('-');
        setExpandedNodes(prev => ({
            ...prev,
            [pathKey]: !prev[pathKey]
        }));
    }, []);

    const handleHistoryClick = async () => {
        setShowMenu(false);
        if (!currentDocument) return;

        try {
            setIsLoading(true);
            const history = await fetchJSON(`/api/history/tree/${apiPath(currentDocument.path)}`);

            setDocumentHistory(history.history);
            setHistoryMode(true);

            // Load the first commit by default
            if (history.history.length > 0) {
                await loadHistoricalDocument(history.history[0].commitHash);
            }
        } catch (err) {
            addNotification(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const loadHistoricalDocument = async (commitHash) => {
        if (!commitHash || !currentDocument) return;
        const reqId = ++historyRequestRef.current;

        try {
            setIsLoading(true);
            const doc = await fetchJSON(`/api/history/doc/${apiPath(currentDocument.path)}/${encodeURIComponent(commitHash)}`);
            if (reqId !== historyRequestRef.current) return;

            setSelectedHistoryCommit(commitHash);
            setHistoricalDocument(doc);
        } catch (err) {
            if (reqId === historyRequestRef.current) addNotification(err.message);
        } finally {
            if (reqId === historyRequestRef.current) setIsLoading(false);
        }
    };

    const restoreHistoricalVersion = async () => {
        if (!currentDocument) return;
        try {
            setIsLoading(true);
            const restoredDoc = await fetchJSON(`/api/history/restore/${apiPath(currentDocument.path)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    commitHash: selectedHistoryCommit,
                    originalPath: currentDocument.path
                })
            });

            setHistoryMode(false);
            setSelectedHistoryCommit(null);
            setHistoricalDocument(null);
            setCurrentDocument(restoredDoc);
            setShowRestoreConfirm(false);

            // Refresh the document tree
            await fetchRelatedDocuments(restoredDoc.path.split('/').slice(0, -1).join('/'));
        } catch (err) {
            addNotification(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const exitHistoryMode = () => {
        setHistoryMode(false);
        setSelectedHistoryCommit(null);
        setHistoricalDocument(null);
        if (currentDocument) fetchDocument(currentDocument.path.split('/'));
    };

    const enterEditMode = useCallback(() => {
        setEditedTitle(currentDocument?.title || '');
        setPrevTitle(currentDocument?.title || '');
        setPrevContent(currentDocument?.content || '');
        setEditMode(true);
        editorRef.current?.clearSelection();
    }, [currentDocument]);

    const exitEditMode = () => {
        // Discard edits: restore content/title from the server so a pending
        // auto-save does not apply the discarded changes.
        if (currentDocument) {
            setEditedTitle(currentDocument.title || '');
            setPrevTitle(currentDocument.title || '');
            setMarkdown(currentDocument.content || '');
            setPrevContent(currentDocument.content || '');
        }
        setSaveStatus(null);
        setEditMode(false);
    };

    const handleSearch = (e) => {
        e.preventDefault();
        if (searchQuery.trim()) {
            navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
        }
    };

    const handlePageChange = (newPage) => {
        const query = searchParams.get('q');
        navigate(`/search?q=${encodeURIComponent(query)}&page=${newPage}`);
    };

    const handleDeleteClick = () => {
        setShowMenu(false);
        const hasChildren = currentDocument?.children?.length > 0;
        const message = hasChildren
            ? t('confirm.deleteWithChildren')
            : t('confirm.deleteDocument');
        if (window.confirm(message)) {
            deleteDocument(hasChildren);
        }
    };

    const handleMoveClick = () => {
        setShowMenu(false);
        setShowMoveModal(true);
    };

    const startDrag = (e) => {
        e.preventDefault();
        setIsDragging(true);
        setPrevSidebarWidth(sidebarWidth);
    };

    const stopDrag = useCallback(() => {
        setIsDragging(false);
    }, []);

    const onDrag = useCallback((e) => {
        if (!isDragging) return;

        const newWidth = e.clientX;
        const halfMinWidth = MIN_SIDEBAR_WIDTH / 2;

        if (isSidebarCollapsed) {
            if (newWidth > halfMinWidth) {
                setIsSidebarCollapsed(false);
                setSidebarWidth(prevSidebarWidth);
            }
        } else {
            if (newWidth < halfMinWidth) {
                setIsSidebarCollapsed(true);
                setSidebarWidth(COLLAPSED_SIDEBAR_WIDTH);
            } else if (newWidth >= MIN_SIDEBAR_WIDTH && newWidth < 500) {
                setSidebarWidth(newWidth);
                localStorage.setItem('sidebarWidth', newWidth)
            }
        }
    }, [isDragging, isSidebarCollapsed, prevSidebarWidth]);

    useEffect(() => {
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', stopDrag);
        return () => {
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('mouseup', stopDrag);
        };
    }, [onDrag, stopDrag]);

    const getDocumentTitle = (path) => {
        let doc = documents;
        const parts = path.split('/');

        for (let i = 0; i < parts.length; i++) {
            if (!doc) break;
            doc = doc.find(d => d.id === parts[i]);
            if (doc && i < parts.length - 1) doc = doc.children;
        }

        return doc?.title || parts[parts.length - 1];
    };


    const renderBreadcrumbs = () => {
        if (!currentDocument || searchResults || editMode || createMode) return null;

        const pathSegments = currentDocument.path.split('/');
        const breadcrumbs = [];

        breadcrumbs.push(
            <span key="root">
            <a
                href="/"
                className="breadcrumb-link"
                onClick={(e) => {
                    e.preventDefault();
                    handleHomeClick();
                }}
                title={t('common.home')}
            >
                <HomeIcon />
            </a>
        </span>
        );

        for (let i = 0; i < pathSegments.length - 1; i++) {
            const path = pathSegments.slice(0, i + 1).join('/');

            breadcrumbs.push(
                <span key={path}>
                <span className="breadcrumb-separator"> / </span>
                <a
                    href={`/doc/${path}`}
                    className="breadcrumb-link"
                    onClick={(e) => {
                        e.preventDefault();
                        navigateToDocumentPath(pathSegments.slice(0, i + 1));
                    }}
                >
                    {getDocumentTitle(path)}
                </a>
            </span>
            );
        }

        return (
            <div className="breadcrumbs">
                {breadcrumbs}
            </div>
        );
    };


    const fetchLastDocuments = useCallback(async () => {
        try {
            setLastDocumentsLoading(true);
            const data = await fetchJSON('/api/views/last');
            setLastDocuments(data);
        } catch (err) {
            addNotification(err.message);
        } finally {
            setLastDocumentsLoading(false);
        }
    }, [addNotification]);

    const fetchFavorites = useCallback(async () => {
        try {
            setFavoritesLoading(true);
            const data = await fetchJSON('/api/favorites');
            setFavorites(data || []); // If null, keep an empty array.
        } catch (err) {
            addNotification(err.message);
        } finally {
            setFavoritesLoading(false);
        }
    }, [addNotification]);

    useEffect(() => {
        if (searchParams.get('q')) return;

        // Dedup: StrictMode in dev (and any re-renders with the same route)
        // must not send a duplicate document request.
        const key = docPath || '';
        if (lastLoadRef.current === key) return;
        lastLoadRef.current = key;

        const loadData = async () => {
            if (docPath) {
                const doc = await fetchDocument(docPath.split('/'));
                if (doc) await fetchRelatedDocuments(docPath);
            } else {
                // Cancel a possibly pending document fetch so it does not navigate us back.
                docRequestRef.current++;
                await fetchRelatedDocuments('');
                await fetchDrafts();
                await fetchLastDocuments();
                await fetchFavorites();
            }
        };

        loadData();
    }, [docPath, fetchDocument, fetchFavorites, fetchRelatedDocuments, searchParams, fetchDrafts, fetchLastDocuments]);

    const toggleFavorite = useCallback(async (path = null) => {
        let targetPath;
        currentDocument ? targetPath = currentDocument?.path : targetPath = path;
        if (!targetPath) return;

        try {
            setIsLoading(true);
            let docToToggle
            currentDocument ? docToToggle = currentDocument: docToToggle = { path: targetPath, favorite: true }; // For favorites on the root page.

            const method = docToToggle.favorite ? 'DELETE' : 'POST';
            await fetchJSON('/api/favorite', {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    path: docToToggle.path
                })
            });

            // Update document state when it is the current document.
            if (docToToggle.path && currentDocument) {
                setCurrentDocument(prev => ({
                    ...prev,
                    favorite: !prev.favorite
                }));
            }

            // Update the document in the tree.
            setDocuments(prevDocs => {
                const updateFavorite = (docs) => {
                    return docs.map(doc => {
                        if (doc.path === targetPath) {
                            return { ...doc, favorite: !doc.favorite };
                        }
                        if (doc.children) {
                            return { ...doc, children: updateFavorite(doc.children) };
                        }
                        return doc;
                    });
                };
                return updateFavorite(prevDocs);
            });

            // Refresh the favorites list.
            await fetchFavorites();

        } catch (err) {
            addNotification(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [currentDocument, fetchFavorites, addNotification]);

    const handleDocumentSelect = useCallback(async (id, pathSegments) => {
        if (editMode || createMode) {
            try {
                const hasChanges = editedTitle !== prevTitle || markdown !== prevContent;

                if (hasChanges) {
                    setIsLoading(true);
                    if (editMode) {
                        await saveDocumentDraft();
                    } else if (createMode) {
                        await saveCreateDraft();
                    }
                }

                // Reset edit/create modes.
                setEditMode(false);
                setCreateMode(false);
                setDraftId(null);
                setCreateParentPath('');

                // Navigate to the new document.
                navigateToDocumentPath(pathSegments);
                if (isMobile) setShowMobileMenu(false);
            } catch (err) {
                addNotification(t('notify.failedSaveDraft', { message: err.message }));
            } finally {
                setIsLoading(false);
            }
            return;
        }

        // Normal navigation when not in edit/create mode.
        navigateToDocumentPath(pathSegments);
        if (isMobile) setShowMobileMenu(false);
    }, [editMode, createMode, saveDocumentDraft, saveCreateDraft, navigateToDocumentPath, isMobile, addNotification, editedTitle, markdown, prevContent, prevTitle, t]);

    const handleHomeClick = useCallback(async () => {
        // In edit/create mode, check for changes before saving.
        if (editMode || createMode) {
            try {
                const hasChanges = editedTitle !== prevTitle || markdown !== prevContent;

                if (hasChanges) {
                    setIsLoading(true);
                    if (editMode) {
                        await saveDocumentDraft();
                    } else if (createMode) {
                        await saveCreateDraft();
                        await fetchDrafts();
                    }
                }

                // Reset state.
                // Go to the home page.
                setCurrentDocument(null);
                setSearchResults(null);
                setEditMode(false);
                setCreateMode(false);
                setHistoryMode(false);
                setDraftId(null);
                setCreateParentPath('');
                // Navigate to the new document.
                navigate('/', { replace: true });

            } catch (err) {
                addNotification(t('notify.failedSaveDraft', { message: err.message }));
            } finally {
                setIsLoading(false);
            }
            return;
        }

        // Normal navigation when not in edit/create mode.
        const isAlreadyAtRoot = !docPath && !currentDocument && !searchResults &&
            !editMode && !createMode && !historyMode;

        if (isAlreadyAtRoot) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }

        setCurrentDocument(null);
        setSearchResults(null);
        setEditMode(false);
        setCreateMode(false);
        setHistoryMode(false);
        navigate('/', { replace: true });
    }, [
        editedTitle, markdown, prevContent, prevTitle,
        editMode, createMode, saveDocumentDraft, saveCreateDraft,
        navigate, docPath, currentDocument, searchResults, historyMode, addNotification, fetchDrafts, t
    ]);

    const renderContent = () => {
        if (searchResults) {
            return (
                <SearchResultsView
                    results={searchResults.results}
                    currentPage={searchResults.currentPage}
                    totalPages={searchResults.totalPages}
                    onPageChange={handlePageChange}
                    onSelect={(path) => navigateToDocumentPath(path.split('/'))}
                    query={searchParams.get('q')}
                />
            );
        }

        if (createMode) {
            const currentDraft = draftId ? drafts.find(d => d.id === draftId) : null;

            return (
                <div className="edit-container">
                    <div className="edit-header">
                        <h2>{currentDraft ? t('sections.editDraft') : t('editor.createNewDocument')}</h2>
                        {currentDraft && (
                            <div className="draft-info">
                                <div>
                                    {t('editor.draftSavedAt', { date: formatDocumentDate(currentDraft.created_at) })}
                                    <span className="time-part">, {formatDocumentTime(currentDraft.created_at)}</span>
                                </div>
                                {currentDraft.path && (
                                    <div className="draft-location">
                                        <span className="path-label">{t('sections.location')}</span> {currentDraft.path}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <input
                        type="text"
                        className="title-input"
                        value={editedTitle}
                        onChange={(e) => setEditedTitle(e.target.value)}
                        onKeyDown={handleTitleKeyDown}
                        placeholder={t('editor.titlePlaceholder')}
                    />
                    <div className="editor-wrapper" onKeyDown={handleEditorKeyDown}>
                        <RichTextEditor
                            ref={editorRef}
                            value={markdown}
                            onChange={setMarkdown}
                            onUploadFile={uploadFile}
                            onUploadError={(err) => addNotification(err.message || t('editor.uploadFailed'))}
                            resolveAsset={resolveAsset}
                            placeholder={t('editor.placeholder')}
                        />
                    </div>
                </div>
            );
        } else if (editMode) {
            return (
                <div className="edit-container">
                    <input
                        type="text"
                        className="title-input"
                        value={editedTitle}
                        onChange={(e) => setEditedTitle(e.target.value)}
                        onKeyDown={handleTitleKeyDown}
                        placeholder={t('editor.titlePlaceholder')}
                    />
                    <div className="editor-wrapper" onKeyDown={handleEditorKeyDown}>
                        <RichTextEditor
                            ref={editorRef}
                            value={markdown}
                            onChange={setMarkdown}
                            onUploadFile={uploadFile}
                            onUploadError={(err) => addNotification(err.message || t('editor.uploadFailed'))}
                            resolveAsset={resolveAsset}
                            placeholder={t('editor.placeholder')}
                        />
                    </div>
                </div>
            );
        } else if (historyMode) {
            return (
                <>
                    <div className="view-mode-header">
                        {renderBreadcrumbs()}
                        <h1>{historicalDocument?.title || currentDocument?.title}</h1>
                    </div>
                    <div className="markdown-viewer">
                        <RichTextEditor
                            editable={false}
                            value={historicalDocument?.content || ''}
                            resolveAsset={resolveAsset}
                        />
                    </div>
                </>
            );
        } else {
            return (
                <>
                    {!currentDocument ? (
                        <div className={isMobile ? "root-page-mobile" : "root-page-desktop"}>
                            <RootSections
                                grouped={!isMobile}
                                lastDocuments={lastDocuments}
                                lastDocumentsLoading={lastDocumentsLoading}
                                lastDocumentsExpanded={lastDocumentsExpanded}
                                onToggleLast={() => setLastDocumentsExpanded(!lastDocumentsExpanded)}
                                favorites={favorites || []}
                                favoritesLoading={favoritesLoading}
                                favoritesExpanded={favoritesExpanded}
                                onToggleFavorites={() => setFavoritesExpanded(!favoritesExpanded)}
                                drafts={drafts}
                                draftsExpanded={draftsExpanded}
                                onToggleDrafts={() => setDraftsExpanded(!draftsExpanded)}
                                draftsLoading={draftsLoading}
                                onSelect={(path) => navigateToDocumentPath(path.split('/'))}
                                onToggleFavorite={toggleFavorite}
                                onDraftClick={fetchDraft}
                                onDeleteDraft={deleteDraft}
                            />
                        </div>
                    ) : (
                        <>
                            <div className="view-mode-header">
                                {renderBreadcrumbs()}
                                <h1>{currentDocument?.title}</h1>
                                {currentDocument?.modified && (
                                    <div className="document-meta">
                                    <span className="modified-time">
                                        {formatDocumentDate(currentDocument.modified)}
                                        <span className="time-part">, {formatDocumentTime(currentDocument.modified)}</span>
                                    </span>
                                        {currentDocument.uncommitted && (
                                            <span className="uncommitted-changes">
                                            {t('doc.unsavedChanges')}
                                        </span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Content block */}
                            {(!currentDocument?.content || currentDocument.content.trim() === '') ? (
                                <div className="empty-document">
                                    <div className="no-content">
                                        <FileTextIcon /> {t('doc.noContent')}
                                    </div>
                                    {currentDocument?.children?.length > 0 && (
                                        <div className="children-section">
                                            <h3>{t('doc.childDocuments')}</h3>
                                            <div className="children-list">
                                                {currentDocument.children.map(child => (
                                                    <div
                                                        key={child.id}
                                                        className="child-document-item"
                                                        onClick={() => {
                                                            const newPath = [...currentDocument.path.split('/'), child.id];
                                                            navigateToDocumentPath(newPath);
                                                            if (isMobile) setShowMobileMenu(false);
                                                        }}
                                                    >
                                                        <span className="child-icon"><FileTextIcon /></span>
                                                        <span className="child-title">{child.title}</span>
                                                        <span className="child-chevron"><ChevronRightIcon /></span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="markdown-viewer">
                                    <RichTextEditor
                                        editable={false}
                                        value={currentDocument.content}
                                        resolveAsset={resolveAsset}
                                    />
                                </div>
                            )}
                        </>
                    )}
                </>
            );
        }
    };

    if (isLoading && documents !== null && !documents.length && !searchResults) {
        return <div className="loading">{t('loading.generic')}</div>;
    }

    return (
        <div className="app-container">
            <NotificationPopup notifications={notifications} onClose={removeNotification} />
            <header className="app-header">
                <div className="header-left" onClick={toggleSidebar}>
                    <div className="logo-placeholder">
                        {isSidebarCollapsed && !isMobile ? (
                            <ChevronRightIcon />
                        ) : (
                            <img
                                src="/white_s.png"
                                alt="Home"
                            />
                        )}
                    </div>
                    <h1
                        className="app-title"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleHomeClick();
                        }}
                    >
                        Okidoki
                    </h1>
                </div>

                <div className="header-center">
                    <form onSubmit={handleSearch} className="search-form">
                        <input
                            type="text"
                            placeholder={t('search.placeholder')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="search-input"
                        />
                        <button type="submit" className="search-button">
                            <MagnifyingGlassIcon />
                        </button>
                    </form>
                </div>

                <div className="header-right">
                    {!historyMode && !editMode && !createMode && currentDocument && (
                        <button
                            className={`favorite-button ${currentDocument.favorite ? 'favorited' : ''}`}
                            onClick={toggleFavorite}
                            title={currentDocument.favorite ? t('sections.removeFavorite') : t('doc.addToFavorites')}
                        >
                            {currentDocument.favorite ? <StarFilledIcon /> : <StarIcon />}
                        </button>
                    )}
                    {editMode && <SaveStatusIndicator status={saveStatus} />}
                    {createMode && <SaveStatusIndicator status={saveStatus} />}

                    {historyMode ? (
                        <>
                            <button
                                className="cancel-button"
                                onClick={exitHistoryMode}
                                disabled={isLoading}
                            >
                                <Cross1Icon /> {!isMobile && t('common.cancel')}
                            </button>
                            <button
                                className="save-button"
                                onClick={() => setShowRestoreConfirm(true)}
                                disabled={isLoading || !selectedHistoryCommit}
                            >
                                {isLoading ? t('status.restoring') : <CheckIcon />}
                                {!isMobile && t('common.restore')}
                            </button>
                        </>
                    ) : createMode ? (
                        <>
                            <button
                                className="cancel-button"
                                onClick={cancelCreate}
                                disabled={isLoading}
                            >
                                <Cross1Icon /> {!isMobile && t('common.cancel')}
                            </button>
                            <button
                                className="save-button"
                                onClick={createDocument}
                                disabled={isLoading}
                            >
                                {isLoading ? t('status.creating') : <CheckIcon />}
                                {!isMobile && t('common.create')}
                            </button>
                        </>
                    ) : editMode ? (
                        <>
                            <button
                                className="cancel-button"
                                onClick={exitEditMode}
                                disabled={isLoading}
                            >
                                <Cross1Icon /> {!isMobile && t('common.cancel')}
                            </button>
                            <button
                                className="save-button"
                                onClick={saveDocument}
                                disabled={isLoading}
                            >
                                {isLoading ? t('status.saving') : <CheckIcon />}
                                {!isMobile && t('common.save')}
                            </button>
                        </>
                    ) : (
                        <>
                            {currentDocument &&(
                            <button
                                className="edit-button"
                                onClick={enterEditMode}
                                disabled={!currentDocument}
                            >
                                <Pencil1Icon />
                                {!isMobile && t('common.edit')}
                            </button>)
                            }
                            <button
                                className="create-button"
                                onClick={() => startCreateNewDocument(currentDocument?.path || '')}
                            >
                                <FilePlusIcon />
                                {!isMobile && t('common.create')}
                            </button>
                        </>
                    )}

                    {!historyMode && (
                        <div className="context-menu-container" ref={menuRef}>
                            <div
                                className="menu-dots"
                                onClick={() => setShowMenu(!showMenu)}
                            >
                                <HamburgerMenuIcon />
                            </div>

                            {showMenu && (
                                <div className="dropdown-menu">
                                    {currentDocument && (
                                        <>
                                            <div
                                                className="dropdown-item"
                                                onClick={handleHistoryClick}
                                            >
                                                <ClockIcon /> {t('common.history')}
                                            </div>
                                            <div
                                                className="dropdown-item"
                                                onClick={handleMoveClick}
                                            >
                                                <MoveIcon /> {t('common.move')}
                                            </div>
                                            {!currentDocument.hasChildren && (
                                                <div
                                                    className="dropdown-item danger"
                                                    onClick={handleDeleteClick}
                                                >
                                                    <TrashIcon /> {t('common.delete')}
                                                </div>
                                            )}
                                        </>
                                    )}
                                    {createMode && draftId && (
                                        <div
                                            className="dropdown-item danger"
                                            onClick={handleDeleteDraftClick}
                                        >
                                            <TrashIcon /> {t('sections.deleteDraft')}
                                        </div>
                                    )}
                                    <a
                                        href="https://github.com/portwn/okidoki"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="dropdown-item github-link"
                                    >
                                        <GitHubLogoIcon /> {t('common.github')}
                                    </a>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </header>

                {showMoveModal && (
                    <div className="modal-overlay">
                        <div className="modal">
                            <h2>{t('move.title')}</h2>
                            <p>{t('move.selectParent', { title: currentDocument?.title })}</p>
                            <div className="move-tree-container">
                                <DocumentTree
                                    documents={documents}
                                    currentDocPath={currentDocument?.path}
                                    selectedPath={moveTargetId}
                                    onSelect={(_id, path) => setMoveTargetId(path.join('/'))}
                                    expandedNodes={expandedNodes}
                                    toggleExpand={toggleExpand}
                                    loadChildren={loadChildren}
                                    loadingParents={loadingParents}
                                    showCreateButton={false}
                                    showRootOption={!!currentDocument?.path?.includes('/')}
                                    rootDisabled={!currentDocument?.path?.includes('/')}
                                />
                            </div>
                            <div className="modal-buttons">
                                <button
                                    className="cancel-button"
                                    onClick={() => {
                                        setShowMoveModal(false);
                                        setMoveTargetId(null);
                                    }}
                                >
                                    {t('common.cancel')}
                                </button>
                                <button
                                    className="confirm-button"
                                    onClick={() => moveDocument(moveTargetId)}
                                    disabled={moveTargetId === null || isLoading}
                                >
                                    {isLoading ? t('status.moving') : t('common.move')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {showRestoreConfirm && (
                    <div className="modal-overlay">
                        <div className="modal">
                            <h2>{t('restore.title')}</h2>
                            <p>{t('restore.body')}</p>
                            <div className="modal-buttons">
                                <button
                                    className="cancel-button"
                                    onClick={() => setShowRestoreConfirm(false)}
                                >
                                    {t('common.cancel')}
                                </button>
                                <button
                                    className="confirm-button"
                                    onClick={restoreHistoricalVersion}
                                    disabled={isLoading}
                                >
                                    {isLoading ? t('status.restoring') : t('common.ok')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                <div className="main-content">
                    <div
                        className={`sidebar ${isMobile ? 'mobile-sidebar' : ''} ${showMobileMenu ? 'mobile-sidebar-show' : ''}`}
                        style={{
                            width: isMobile ? '80%' : `${sidebarWidth}px`,
                            cursor: isSidebarCollapsed && !isMobile ? 'pointer' : 'default',
                            position: isMobile ? 'fixed' : 'relative',
                            minWidth: isMobile ? '0' : (isSidebarCollapsed ? `${COLLAPSED_SIDEBAR_WIDTH}px` : `${MIN_SIDEBAR_WIDTH}px`)
                        }}
                        onClick={handleSidebarClick}
                    >
                        {isSidebarCollapsed && !isMobile ? (
                            <div className="collapsed-sidebar-indicator"><ChevronRightIcon /></div>
                        ) : historyMode ? (
                            <HistoryList
                                history={documentHistory}
                                selectedCommit={selectedHistoryCommit}
                                onSelect={loadHistoricalDocument}
                            />
                        ) : isLoading ? (
                            <div className="loading">{t('loading.generic')}</div>
                        ) : (
                            <DocumentTree
                                documents={documents}
                                currentDocPath={currentDocument?.path}
                                onSelect={handleDocumentSelect}
                                expandedNodes={expandedNodes}
                                toggleExpand={toggleExpand}
                                loadChildren={loadChildren}
                                loadingParents={loadingParents}
                                onCreateNewDocument={startCreateNewDocument} // Pass the handler.
                            />
                        )}
                    </div>

                    {!isMobile && (
                        <div
                            className={`divider${isSidebarCollapsed ? ' is-hidden' : ''}`}
                            onMouseDown={startDrag}
                        />
                    )}

                    <div className={editMode || createMode ? 'content content-editing' : 'content'}>
                        {searchLoading ? (
                            <div className="loading">{t('loading.searching')}</div>
                        ) : searchError ? (
                            <div className="error">{t('search.error', { message: searchError })}</div>
                        ) : (
                            renderContent()
                        )}
                    </div>

                    {isMobile && showMobileMenu && (
                        <div className="mobile-sidebar-overlay" onClick={() => setShowMobileMenu(false)} />
                    )}
                </div>
        </div>
    );
}

export default App;