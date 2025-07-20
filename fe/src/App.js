import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Editable, useEditor } from "@wysimark/react";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { customAlphabet } from 'nanoid';
import './App.css';
// Импорт иконок из Radix UI
import {
    MagnifyingGlassIcon,
    StarIcon,
    StarFilledIcon,
    Pencil1Icon,
    FilePlusIcon,
    Cross1Icon,
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

const formatDocumentDate = (dateString) => {
    if (!dateString) return 'Unknown date';

    try {
        const date = new Date(dateString);
        const day = date.getDate();
        const month = date.toLocaleString('en-US', { month: 'long' });
        const year = date.getFullYear();

        return `${day} ${month} ${year}`;
    } catch (e) {
        return dateString || 'Unknown date';
    }
};

const formatDocumentTime = (dateString) => {
    if (!dateString) return '';

    try {
        const date = new Date(dateString);
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');

        return `${hours}:${minutes}`;
    } catch (e) {
        return '';
    }
};

const DocumentTree = ({
                          documents,
                          currentDocPath, // Принимаем полный путь вместо ID
                          onSelect,
                          expandedNodes,
                          toggleExpand,
                          loadChildren,
                          loadingParents,
                          onCreateNewDocument // Добавляем новый пропс
                      }) => {
    const renderDocuments = (docs, parentPath = []) => {
        if (!docs) return null;

        return docs.map(doc => {
            const path = [...parentPath, doc.id];
            const pathKey = path.join('-');
            const isExpanded = expandedNodes[pathKey];
            const isLoading = loadingParents[pathKey];
            const docFullPath = path.join('/');
            const isActive = currentDocPath === docFullPath;

            return (
                <div key={doc.id} style={{ marginLeft: `${(path.length - 1) * 15}px` }}>
                    <div className="document-item">
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
                        style={{ cursor: 'pointer' }}
                    >
                        {isLoading ? '⌛' : doc.hasChildren ? (isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />) : <DotFilledIcon />}
                    </span>
                        <span
                            className={`document-title ${isActive ? 'active' : ''}`}
                            onClick={() => {
                                onSelect(doc.id, path);
                            }}
                            style={{ cursor: 'pointer' }}
                        >
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
            {/* Добавляем кнопку создания нового документа */}
            <div
                className="new-document-button"
                onClick={onCreateNewDocument}
            >
                <FilePlusIcon /> New Document
            </div>
            {renderDocuments(documents)}
        </div>
    );
};

const HistoryList = ({ history, selectedCommit, onSelect }) => {
    return (
        <div className="history-list">
            <h3>Document History</h3>
            {history.map((commit) => (
                <div
                    key={commit.commitHash}
                    className={`history-item ${selectedCommit === commit.commitHash ? 'selected' : ''}`}
                    onClick={() => onSelect(commit.commitHash)}
                >
                    <div className="commit-message">{commit.message || 'No commit message'}</div>
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

const SearchResultsView = ({ results, currentPage, totalPages, onPageChange, query }) => {
    return (
        <div className="search-results-container">
            <h2>Search Results for "{query}"</h2>
            {results.length === 0 ? (
                <p>No results found</p>
            ) : (
                <>
                    <div className="results-list">
                        {results.map((doc, index) => (
                            <div key={doc.id} className="search-result-item">
                                <div className="result-number">{(currentPage - 1) * 10 + index + 1}.</div>
                                <div className="result-content">
                                    <h3
                                        className="result-title"
                                        onClick={() => window.location.href = `/doc/${doc.path}`}
                                        style={{ cursor: 'pointer'}}
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
                                    Previous
                                </button>
                            )}

                            <span className="page-info">
                                Page {currentPage} of {totalPages}
                            </span>

                            {currentPage < totalPages && (
                                <button
                                    onClick={() => onPageChange(currentPage + 1)}
                                    className="pagination-button"
                                >
                                    Next
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
    const handleDelete = (e, draftId) => {
        e.stopPropagation(); // Предотвращаем срабатывание клика по черновику
        if (window.confirm('Are you sure you want to delete this draft?')) {
            onDeleteDraft(draftId);
        }
    };

    return (
        <div className="section-container drafts-section">
            <div className="section-header" onClick={onToggle}>
                <h3><FileTextIcon className="section-icon" /> Drafts</h3>
                <span className="toggle-icon">{expanded ? '▼' : '▶'}</span>
            </div>
            {expanded && (
                <div className="section-content">
                    {loading ? (
                        <div className="loading">Loading drafts...</div>
                    ) : drafts.length === 0 ? (
                        <div className="no-drafts">No drafts found</div>
                    ) : (
                        drafts.map(draft => (
                            <div
                                key={draft.id}
                                className="favorite-item"
                                onClick={() => onDraftClick(draft.id)}
                            >
                                <div className="draft-content">
                                    <div className="draft-title">{draft.title || 'Untitled Draft'}</div>
                                    {draft.path && (
                                        <div className="draft-path">
                                            <span className="path-label">Path:</span> {draft.path}
                                        </div>
                                    )}
                                    <div className="draft-date">{formatDocumentDate(draft.created_at)}
                                        <span className="time-part">, {formatDocumentTime(draft.created_at)}</span>
                                    </div>
                                </div>
                                <div
                                    className="draft-delete"
                                    onClick={(e) => handleDelete(e, draft.id)}
                                    title="Delete draft"
                                >
                                    🗑️
                                </div>
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
    return (
        <div className="last-documents-section">
            <div className="section-header" onClick={onToggle}>
                <h3><ClockIcon className="section-icon" /> Last Viewed</h3>
                <span className="toggle-icon">{expanded ? '▼' : '▶'}</span>
            </div>
            {expanded && (
                <>
                    {loading ? (
                        <div className="loading">Loading last documents...</div>
                    ) : documents.length === 0 ? (
                        <div className="no-documents">No recent documents</div>
                    ) : (
                        <div className="last-documents-list">
                            {documents.map(doc => (
                                <div
                                    key={doc.id}
                                    className="last-document-item"
                                    onClick={() => onSelect(doc.path)}
                                >
                                    <div className="last-document-title">{doc.title}</div>
                                    {doc.path && (
                                        <div className="last-document-path">{doc.path}</div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </>
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
    const handleToggleFavorite = (e, path) => {
        e.stopPropagation();
        onToggleFavorite(path);
    };

    return (
        <div className="section-container favorites-section">
            <div className="section-header" onClick={onToggle}>
                <h3><StarFilledIcon className="section-icon" /> Favorites</h3>
                <span className="toggle-icon">{expanded ? '▼' : '▶'}</span>
            </div>
            {expanded && documents !== null && (
                <>
                    {loading ? (
                        <div className="loading">Loading favorites...</div>
                    ) : documents.length === 0 ? (
                        <div className="no-documents">No favorite documents</div>
                    ) : (
                        <div className="favorites-list">
                            {documents.map(doc => (
                                <div
                                    key={doc.id}
                                    className="favorite-item"
                                    onClick={() => onSelect(doc.path)}
                                >
                                    <div className="favorite-title">{doc.title}</div>
                                    {doc.path && (
                                        <div className="favorite-path">{doc.path}</div>
                                    )}
                                    <div
                                        className="favorite-star"
                                        onClick={(e) => handleToggleFavorite(e, doc.path)}
                                        title="Remove from favorites"
                                    >
                                        ★
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

const NotificationPopup = ({ notifications, onClose }) => {
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
            {notifications.map((notification, index) => (
                <div
                    key={notification.id}
                    className={`notification-popup ${notification.type} ${exitingIds.includes(notification.id) ? 'exiting' : ''}`}
                    style={{ bottom: `${index * 70 + 20}px` }}
                >
                    <div className="notification-content">
                        <span className="notification-message">{notification.message}</span>
                        <button
                            className="notification-close"
                            onClick={() => handleClose(notification.id)}
                        >
                            ×
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
};

function App() {
    const NOTIFICATION_TYPES = {
        ERROR: 'error',
        WARNING: 'warning'
    };

    const MIN_SIDEBAR_WIDTH = 150;
    const COLLAPSED_SIDEBAR_WIDTH = MIN_SIDEBAR_WIDTH / 4;

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
    const [notifications, setNotifications] = useState([]);
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
    const [selectedHistoryCommit, setSelectedHistoryCommit] = useState(null);
    const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
    const [saveStatus, setSaveStatus] = useState(null);
    const [lastSavedTime, setLastSavedTime] = useState(0);

    const { '*': docPath } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const menuRef = useRef(null);
    const editor = useEditor({ authToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InY5TThzVHVIelNEeUpNZ0cifQ.eyJpYXQiOjE3NTI1OTQ1ODQsImV4cCI6MTc4NDE1MjE4NH0.EuVn-5PbX7yD0cgPEWwC65P_z3YuoW2e6BLzsUoyogs" });

    const [draftId, setDraftId] = useState(null);
    const [prevTitle, setPrevTitle] = useState('');
    const [prevContent, setPrevContent] = useState('');

    // Mobile states
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
    const [showMobileMenu, setShowMobileMenu] = useState(false);

    // Добавим в состояние компонента App
    const [drafts, setDrafts] = useState([]);
    const [draftsExpanded, setDraftsExpanded] = useState(true);
    const [draftsLoading, setDraftsLoading] = useState(false);

    // Добавим в состояние
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
        // Режим редактирования
        if (editMode && currentDocument) {
            document.title = `*${currentDocument.title}`;
            return;
        }

        // Режим создания
        if (createMode) {
            document.title = draftId ? '*Draft' : 'Create New Document';
            return;
        }

        // Результаты поиска
        if (searchResults) {
            const query = searchParams.get('q') || '';
            document.title = `Search: "${query}"`;
            return;
        }

        // Просмотр документа
        if (currentDocument) {
            document.title = `${currentDocument.title}`;
            return;
        }

        // По умолчанию
        document.title = 'Okidoki';
    }, [
        currentDocument,
        editMode,
        createMode,
        historyMode,
        searchResults,
        searchParams,
        isLoading,
        draftId
    ]);

    // Функция для добавления ошибки
    const addNotification = useCallback((message, type = NOTIFICATION_TYPES.ERROR) => {
        const id = Date.now();
        setNotifications(prev => [...prev, { id, message, type }]);

        const timer = setTimeout(() => {
            setNotifications(prev => prev.filter(n => n.id !== id));
        }, 5000);

        return () => clearTimeout(timer);
    }, [NOTIFICATION_TYPES.ERROR]);

    // Функция для удаления ошибки
    const removeNotification = useCallback((errorId) => {
        setNotifications(prev => prev.filter(error => error.id !== errorId));
    }, []); // Аналогично, только setNotifications



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
            const response = await fetch(`/api/document/${currentDocument.path}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: editedTitle,
                    content: markdown,
                    commit_changes: false
                })
            });

            if (!response.ok) throw new Error('Failed to save draft');
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

            // Проверяем, были ли изменения
            const hasChanges = editedTitle !== prevTitle || markdown !== prevContent;
            if (!hasChanges) return;

            try {
                await saveDocumentDraft();
                setSaveStatus('success');
                setLastSavedTime(now);
                // Обновляем предыдущие значения после сохранения
                setPrevTitle(editedTitle);
                setPrevContent(markdown);
                setTimeout(() => setSaveStatus(null), 2000);
            } catch (err) {
                setSaveStatus('error');
                console.error('Auto-save failed:', err);
                setTimeout(() => setSaveStatus(null), 2000);
            }
        };

        const timer = setTimeout(handleAutoSave, 5000);

        return () => {
            clearTimeout(timer);
        };
    }, [editMode, markdown, editedTitle, currentDocument, lastSavedTime, saveDocumentDraft, prevTitle, prevContent]);

    const saveCreateDraft = useCallback(async () => {
        try {
            const draftIdToSave = draftId || nanoid();
            let draftPath = docPath || '';

            if (currentDocument) {
                draftPath = currentDocument.path;
            }

            const response = await fetch('/api/draft', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    id: draftIdToSave,
                    title: editedTitle,
                    content: markdown,
                    path: draftPath
                })
            });

            if (!response.ok) throw new Error('Failed to save draft');

            if (!draftId) {
                setDraftId(draftIdToSave);
            }

            return true;
        } catch (err) {
            addNotification(err.message);
            throw err;
        }
    }, [draftId, editedTitle, markdown, docPath, currentDocument, addNotification]);

    useEffect(() => {
        if (!createMode) return;

        const handleAutoSave = async () => {
            const now = Date.now();
            if (now - lastSavedTime < 5000) return;

            // Проверяем, были ли изменения
            const hasChanges = editedTitle !== prevTitle || markdown !== prevContent;
            if (!hasChanges) return;

            try {
                // Если draftId еще нет, сохраняем как новый черновик
                await saveCreateDraft();

                setSaveStatus('success');
                setLastSavedTime(now);
                // Обновляем предыдущие значения после сохранения
                setPrevTitle(editedTitle);
                setPrevContent(markdown);
                setTimeout(() => setSaveStatus(null), 2000);
            } catch (err) {
                setSaveStatus('error');
                console.error('Auto-save failed:', err);
                setTimeout(() => setSaveStatus(null), 2000);
            }
        };

        const timer = setTimeout(handleAutoSave, 5000);

        return () => {
            clearTimeout(timer);
        };
    }, [createMode, markdown, editedTitle, lastSavedTime, saveCreateDraft, prevTitle, prevContent]);

    const performSearch = async (query, page = 1) => {
        try {
            setSearchLoading(true);
            setSearchError(null);

            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&page=${page}&pageSize=10`);
            if (!response.ok) throw new Error('Search failed');

            const data = await response.json();
            setSearchResults(data);
        } catch (err) {
            setSearchError(err.message);
        } finally {
            setSearchLoading(false);
        }
    };

    const SaveStatusIndicator = ({ status }) => {
        if (!status) return null;

        return (
            <div className={`save-status ${status === 'success' ? 'success' : 'error'}`}>
                {status === 'success' ? (
                    <>
                        <span className="save-icon">💾</span> Saved
                    </>
                ) : (
                    <>
                        <span className="save-icon">❌💾</span> Save error
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
            const response = await fetch(`/api/documents/${parentPath}`);
            if (!response.ok) throw new Error('Failed to load children');
            const children = await response.json();

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
        try {
            setIsLoading(true);
            const endpoint = docPath ? `/api/related/${docPath}` : '/api/documents';
            const response = await fetch(endpoint);
            if (!response.ok) throw new Error('Failed to load related documents');

            let data = await response.json();

            if (!docPath) {
                data = { root: data };
            }

            // Создаем новый объект expandedNodes, сохраняя только корневой узел
            const newExpandedNodes = { 'root': true };

            // Если есть docPath, раскрываем путь к текущему документу
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
            addNotification(err.message);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [addNotification]);

    const fetchDraft = useCallback(async (draftId) => {
        try {
            setIsLoading(true);
            const response = await fetch(`/api/draft/${draftId}`);
            if (!response.ok) throw new Error('Failed to load draft');

            const draft = await response.json();
            setEditedTitle(draft.title);
            setMarkdown(draft.content);
            setPrevTitle(draft.title);
            setPrevContent(draft.content);
            setDraftId(draftId);
            setCreateMode(true);
            setCurrentDocument(null);
        } catch (err) {
            addNotification(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [addNotification]);

    const fetchDocument = useCallback(async (pathSegments) => {
        try {
            setIsLoading(true);
            const path = pathSegments.join('/');

            const response = await fetch(`/api/document/${path}`);
            if (!response.ok) throw new Error('Document not found');
            const doc = await response.json();

            setCurrentDocument(doc);
            setMarkdown(doc.content || '');
            setPrevTitle(doc.title);
            setPrevContent(doc.content || '');

            return doc;
        } catch (err) {
            addNotification(err.message);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [addNotification]);

    const saveDocument = useCallback(async () => {
        try {
            setIsLoading(true);
            // Проверяем, есть ли изменения ИЛИ документ имеет uncommitted: true
            const hasChanges = editedTitle !== prevTitle || markdown !== prevContent;
            const needsSave = hasChanges || currentDocument?.uncommitted;

            if (!needsSave) {
                setEditMode(false);
                setIsLoading(false);
                return;
            }

            const response = await fetch(`/api/document/${currentDocument.path}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: editedTitle,
                    content: markdown,
                    commit_changes: true
                })
            });

            if (!response.ok) throw new Error('Failed to save');

            const updatedDoc = await response.json();
            setCurrentDocument(updatedDoc);
            setEditMode(false);
            setSaveStatus('success');
            // Обновляем предыдущие значения после сохранения
            setPrevTitle(editedTitle);
            setPrevContent(markdown);
            setTimeout(() => setSaveStatus(null), 2000);

            await fetchRelatedDocuments(updatedDoc.path);
            navigateToDocumentPath(updatedDoc.path.split('/'));
        } catch (err) {
            addNotification(err.message);
            setSaveStatus('error');
            setTimeout(() => setSaveStatus(null), 2000);
        } finally {
            setIsLoading(false);
        }
    }, [currentDocument, editedTitle, markdown, prevTitle, prevContent, fetchRelatedDocuments, navigateToDocumentPath, addNotification]);

    // Функция для загрузки черновиков
    const fetchDrafts = useCallback(async () => {
        try {
            setDraftsLoading(true);
            const response = await fetch('/api/drafts');
            if (!response.ok) throw new Error('Failed to load drafts');
            const data = await response.json();
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
            const response = await fetch(`/api/draft/${draftId}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to delete draft');
            }

            // Обновляем список черновиков после удаления
            await fetchDrafts();
            setSaveStatus('success');
            setTimeout(() => setSaveStatus(null), 2000);
        } catch (err) {
            addNotification(err.message);
            setSaveStatus('error');
            setTimeout(() => setSaveStatus(null), 2000);
        }
    }, [fetchDrafts, addNotification]);

    const createDocument = useCallback(async () => {
        try {
            setIsLoading(true);

            // Определяем parentPath
            let parentPath = docPath || '';

            // Если у нас есть draftId, берем путь из черновика
            if (draftId) {
                const draft = drafts.find(d => d.id === draftId);
                if (draft?.path) {
                    parentPath = draft.path;
                }
            }

            let url = '/api/document';
            const body = {
                title: editedTitle || 'New Document',
                content: markdown
            };

            // Добавляем parentPath только если он есть
            if (parentPath) {
                body.parentPath = parentPath;
            }

            // Если черновик существует, добавляем его ID в запрос
            if (draftId) {
                url += `?draft=${draftId}`;
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body)
            });

            if (response.status === 202) {
                addNotification('Parent directory not found, created in root', NOTIFICATION_TYPES.WARNING);
            }

            if (!response.ok) throw new Error('Failed to create document');

            const newDoc = await response.json();

            navigateToDocumentPath(newDoc.path.split('/'));
            setCurrentDocument(newDoc);
            setCreateMode(false);
            setDraftId(null);

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
    }, [NOTIFICATION_TYPES.WARNING, draftId, editedTitle, markdown, docPath, drafts, navigateToDocumentPath, addNotification]);

    const deleteDocument = useCallback(async () => {
        if (!currentDocument) return;

        try {
            setIsLoading(true);
            const parentPath = currentDocument.path.split('/').slice(0, -1).join('/');

            const response = await fetch(`/api/document/${currentDocument.path}`, {
                method: 'DELETE'
            });

            if (!response.ok) throw new Error('Failed to delete document');

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

    const moveDocument = useCallback(async (targetId) => {
        if (!currentDocument || !targetId) return;

        try {
            setIsLoading(true);
            const targetDocResponse = await fetch(`/api/document/${targetId}`);
            if (!targetDocResponse.ok) throw new Error('Target folder not found');
            const targetDoc = await targetDocResponse.json();

            const response = await fetch(`/api/document/${currentDocument.path}/move`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    targetPath: targetDoc.path
                })
            });

            if (!response.ok) throw new Error('Failed to move document');

            await fetchRelatedDocuments(targetDoc.path);

            const newPath = targetDoc.path.split('/');
            newPath.push(currentDocument.id);
            navigateToDocumentPath(newPath);

            setShowMoveModal(false);
            setShowMenu(false);
        } catch (err) {
            addNotification(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [currentDocument, navigateToDocumentPath, fetchRelatedDocuments, addNotification]);

    const startCreateNewDocument = useCallback(() => {
        setDraftId(null); // Сбрасываем draftId
        setEditedTitle('');
        setPrevTitle('');
        setMarkdown('');
        setPrevContent('');
        setCreateMode(true);
        setCurrentDocument(null);
        // Очищаем выделение в редакторе
        if (editor) {
            editor.selection = null;
            // Transforms.deselect(editor);
        }
    }, [editor]);

    const cancelCreate = useCallback(() => {
        setCreateMode(false);
        setDraftId(null);
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
            const response = await fetch(`/api/history/tree/${currentDocument.path}`);
            if (!response.ok) throw new Error('Failed to load history');

            const history = await response.json();
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
        if (!commitHash) return;

        try {
            setIsLoading(true);
            const response = await fetch(`/api/history/doc/${currentDocument.path}/${commitHash}`);
            if (!response.ok) throw new Error('Failed to load historical document');

            const doc = await response.json();
            setSelectedHistoryCommit(commitHash);
            setCurrentDocument(doc);
        } catch (err) {
            addNotification(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const restoreHistoricalVersion = async () => {
        try {
            setIsLoading(true);
            const response = await fetch(`/api/history/restore/${currentDocument.path}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    commitHash: selectedHistoryCommit,
                    originalPath: currentDocument.path
                })
            });

            if (!response.ok) throw new Error('Failed to restore document');

            const restoredDoc = await response.json();
            setHistoryMode(false);
            setSelectedHistoryCommit(null);
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
        fetchDocument(currentDocument.path.split('/'));
    };

    const enterEditMode = useCallback(() => {
        setEditedTitle(currentDocument?.title || '');
        setPrevTitle(currentDocument?.title || '');
        setPrevContent(currentDocument?.content || '');
        setEditMode(true);
        if (editor) {
            editor.selection = null;
        }
    }, [currentDocument, editor]);

    const exitEditMode = () => {
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
        if (window.confirm('Are you sure you want to delete this document?')) {
            deleteDocument();
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
    }, [isDragging, isSidebarCollapsed, MIN_SIDEBAR_WIDTH, COLLAPSED_SIDEBAR_WIDTH, prevSidebarWidth]);

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
                    setCurrentDocument(null);
                    setSearchResults(null);
                    setEditMode(false);
                    setCreateMode(false);
                    setHistoryMode(false);
                    navigate('/');
                    fetchRelatedDocuments('');
                    fetchDrafts();
                    fetchLastDocuments();
                    fetchFavorites();
                }}
                title="Home"
            >
                <HomeIcon style={{ width: 16, height: 16 }} />
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
            const response = await fetch('/api/views/last');
            if (!response.ok) throw new Error('Failed to load last documents');
            const data = await response.json();
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
            const response = await fetch('/api/favorites');
            if (!response.ok) throw new Error('Failed to load favorites');

            const data = await response.json();
            setFavorites(data || []); // Если null, сохраняем пустой массив
        } catch (err) {
            addNotification(err.message);
        } finally {
            setFavoritesLoading(false);
        }
    }, [addNotification]);

    useEffect(() => {
        const loadData = async () => {
            if (docPath && !searchParams.get('q')) {
                await fetchDocument(docPath.split('/'));
                await fetchRelatedDocuments(docPath);
            } else if (!docPath && !searchParams.get('q')) {
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
            currentDocument ? docToToggle = currentDocument: docToToggle = { path: targetPath, favorite: true }; // Для избранных на корневой странице

            const method = docToToggle.favorite ? 'DELETE' : 'POST';
            const response = await fetch('/api/favorite', {
                method,
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    path: docToToggle.path
                })
            });

            if (!response.ok) throw new Error('Failed to update favorite status');

            // Обновляем состояние документа, если это текущий документ
            if (docToToggle.path && currentDocument) {
                setCurrentDocument(prev => ({
                    ...prev,
                    favorite: !prev.favorite
                }));
            }

            // Обновляем документ в дереве
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

            // Обновляем список избранного
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
                const hasChanges = editMode
                    ? editedTitle !== prevTitle || markdown !== prevContent
                    : editedTitle || markdown;

                if (hasChanges) {
                    setIsLoading(true);
                    if (editMode) {
                        await saveDocumentDraft();
                    } else if (createMode) {
                        await saveCreateDraft();
                    }
                }

                // Сбрасываем режимы редактирования/создания
                setEditMode(false);
                setCreateMode(false);
                setDraftId(null);

                // Переходим к новому документу
                navigateToDocumentPath(pathSegments);
                if (isMobile) setShowMobileMenu(false);
            } catch (err) {
                addNotification('Failed to save draft: ' + err.message);
            } finally {
                setIsLoading(false);
            }
            return;
        }

        // Обычный переход, если не в режиме редактирования/создания
        navigateToDocumentPath(pathSegments);
        if (isMobile) setShowMobileMenu(false);
    }, [editMode, createMode, saveDocumentDraft, saveCreateDraft, navigateToDocumentPath, isMobile, addNotification, editedTitle, markdown, prevContent, prevTitle]);

    const handleHomeClick = useCallback(async () => {
        // Если в режиме редактирования/создания - проверяем изменения перед сохранением
        if (editMode || createMode) {
            try {
                const hasChanges = editMode
                    ? editedTitle !== prevTitle || markdown !== prevContent
                    : editedTitle || markdown;

                if (hasChanges) {
                    setIsLoading(true);
                    if (editMode) {
                        await saveDocumentDraft();
                    } else if (createMode) {
                        await saveCreateDraft();
                        await fetchDrafts();
                    }
                }

                // Сбрасываем состояния
                // // Переходим на домашнюю страницу
                setCurrentDocument(null);
                setSearchResults(null);
                setEditMode(false);
                setCreateMode(false);
                setHistoryMode(false);
                setDraftId(null);
                // Переходим к новому документу
                navigate('/', { replace: true });

            } catch (err) {
                addNotification('Failed to save draft: ' + err.message);
            } finally {
                setIsLoading(false);
            }
            return;
        }

        // Обычный переход, если не в режиме редактирования/создания
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
        navigate, docPath, currentDocument, searchResults, historyMode, addNotification, fetchDrafts
    ]);

    const renderContent = () => {
        if (searchResults) {
            return (
                <SearchResultsView
                    results={searchResults.results}
                    currentPage={searchResults.currentPage}
                    totalPages={searchResults.totalPages}
                    onPageChange={handlePageChange}
                    query={searchParams.get('q')}
                />
            );
        }

        if (createMode) {
            const currentDraft = draftId ? drafts.find(d => d.id === draftId) : null;

            return (
                <div className="edit-container">
                    <div className="edit-header">
                        <h2>{currentDraft ? 'Edit Draft' : 'Create New Document'}</h2>
                        {currentDraft && (
                            <div className="draft-info">
                                <div>
                                    Editing draft (saved {formatDocumentDate(currentDraft.created_at)})
                                    <span className="time-part">, {formatDocumentTime(currentDraft.created_at)}</span>
                                </div>
                                {currentDraft.path && (
                                    <div className="draft-location">
                                        <span className="path-label">Location:</span> {currentDraft.path}
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
                        placeholder="Document title"
                    />
                    <div className="editor-wrapper">
                        <Editable
                            editor={editor}
                            value={markdown}
                            onChange={setMarkdown}
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
                        placeholder="Document title"
                    />
                    <div className="editor-wrapper">
                        <Editable
                            editor={editor}
                            value={markdown}
                            onChange={setMarkdown}
                        />
                    </div>
                </div>
            );
        } else if (historyMode) {
            return (
                <>
                    <div className="view-mode-header">
                        {renderBreadcrumbs()}
                        <h1>{currentDocument?.title}</h1>
                    </div>
                    <div className="markdown-viewer">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {currentDocument?.content || ''}
                        </ReactMarkdown>
                    </div>
                </>
            );
        } else {
            return (
                <>
                    {!currentDocument ? (
                        <div className={isMobile ? "root-page-mobile" : "root-page-desktop"}>
                            {isMobile ? (
                                <>
                                    <LastDocumentsSection
                                        documents={lastDocuments}
                                        loading={lastDocumentsLoading}
                                        onSelect={(path) => navigateToDocumentPath(path.split('/'))}
                                        expanded={lastDocumentsExpanded}
                                        onToggle={() => setLastDocumentsExpanded(!lastDocumentsExpanded)}
                                    />
                                    <FavoritesSection
                                        documents={favorites || []}
                                        loading={favoritesLoading}
                                        onSelect={(path) => navigateToDocumentPath(path.split('/'))}
                                        expanded={favoritesExpanded}
                                        onToggle={() => setFavoritesExpanded(!favoritesExpanded)}
                                        onToggleFavorite={toggleFavorite}
                                    />
                                    <DraftsSection
                                        drafts={drafts}
                                        expanded={draftsExpanded}
                                        onToggle={() => setDraftsExpanded(!draftsExpanded)}
                                        loading={draftsLoading}
                                        onDraftClick={fetchDraft}
                                        onDeleteDraft={deleteDraft}
                                    />
                                </>
                            ) : (
                                <>
                                    <div>
                                        <LastDocumentsSection
                                            documents={lastDocuments}
                                            loading={lastDocumentsLoading}
                                            onSelect={(path) => navigateToDocumentPath(path.split('/'))}
                                            expanded={lastDocumentsExpanded}
                                            onToggle={() => setLastDocumentsExpanded(!lastDocumentsExpanded)}
                                        />
                                        <FavoritesSection
                                            documents={favorites || []}
                                            loading={favoritesLoading}
                                            onSelect={(path) => navigateToDocumentPath(path.split('/'))}
                                            expanded={favoritesExpanded}
                                            onToggle={() => setFavoritesExpanded(!favoritesExpanded)}
                                            onToggleFavorite={toggleFavorite}
                                        />
                                    </div>
                                    <div>
                                        <DraftsSection
                                            drafts={drafts}
                                            expanded={draftsExpanded}
                                            onToggle={() => setDraftsExpanded(!draftsExpanded)}
                                            loading={draftsLoading}
                                            onDraftClick={fetchDraft}
                                            onDeleteDraft={deleteDraft}
                                        />
                                    </div>
                                </>
                            )}
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
                                            • Have unsaved changes
                                        </span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Измененная часть для отображения содержимого документа */}
                            {(!currentDocument?.content || currentDocument.content.trim() === '') ? (
                                <div className="empty-document">
                                    <div className="no-content">No content</div>
                                    {currentDocument?.children && (
                                        <div className="children-section">
                                            <h3>Child documents:</h3>
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
                                                        {child.title}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="markdown-viewer">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {currentDocument.content}
                                    </ReactMarkdown>
                                </div>
                            )}
                        </>
                    )}
                </>
            );
        }
    };

    if (isLoading && documents !== null && !documents.length && !searchResults) {
        return <div className="loading">Loading...</div>;
    }

    return (
        <div className="app-container">
            <NotificationPopup notifications={notifications} onClose={removeNotification} />
            <header className="app-header">
                <div className="header-left">
                    <div className="logo-placeholder" onClick={toggleSidebar}>
                        {isSidebarCollapsed && !isMobile ? (
                            <ChevronRightIcon />
                        ) : (
                            <img
                                src="/white_s.png"
                                alt="Home"
                                style={{
                                    width: "40px",
                                    height: "40px",
                                    borderRadius: "50%",
                                    objectFit: "cover",
                                }}
                            />
                        )}
                    </div>
                    <h1 className="app-title" onClick={handleHomeClick}>
                        Okidoki
                    </h1>
                </div>

                <div className="header-center">
                    <form onSubmit={handleSearch} className="search-form">
                        <input
                            type="text"
                            placeholder="Search..."
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
                            title={currentDocument.favorite ? 'Remove from favorites' : 'Add to favorites'}
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
                                <Cross1Icon /> {!isMobile && 'Cancel'}
                            </button>
                            <button
                                className="save-button"
                                onClick={() => setShowRestoreConfirm(true)}
                                disabled={isLoading || !selectedHistoryCommit}
                            >
                                {isLoading ? 'Restoring...' : <CheckIcon />}
                                {!isMobile && 'Restore'}
                            </button>
                        </>
                    ) : createMode ? (
                        <>
                            <button
                                className="cancel-button"
                                onClick={cancelCreate}
                                disabled={isLoading}
                            >
                                <Cross1Icon /> {!isMobile && 'Cancel'}
                            </button>
                            <button
                                className="save-button"
                                onClick={createDocument}
                                disabled={isLoading}
                            >
                                {isLoading ? 'Creating...' : <CheckIcon />}
                                {!isMobile && 'Create'}
                            </button>
                        </>
                    ) : editMode ? (
                        <>
                            <button
                                className="cancel-button"
                                onClick={exitEditMode}
                                disabled={isLoading}
                            >
                                <Cross1Icon /> {!isMobile && 'Cancel'}
                            </button>
                            <button
                                className="save-button"
                                onClick={saveDocument}
                                disabled={isLoading}
                            >
                                {isLoading ? 'Saving...' : <CheckIcon />}
                                {!isMobile && 'Save'}
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
                                {!isMobile && 'Edit'}
                            </button>)
                            }
                            <button
                                className="create-button"
                                onClick={startCreateNewDocument}
                            >
                                <FilePlusIcon />
                                {!isMobile && 'Create'}
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
                                                <ClockIcon /> History
                                            </div>
                                            <div
                                                className="dropdown-item"
                                                onClick={handleMoveClick}
                                            >
                                                <MoveIcon /> Move
                                            </div>
                                            {!currentDocument.hasChildren && (
                                                <div
                                                    className="dropdown-item danger"
                                                    onClick={handleDeleteClick}
                                                >
                                                    <TrashIcon /> Delete
                                                </div>
                                            )}
                                        </>
                                    )}
                                    <a
                                        href="https://github.com/portwn/okidoki"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="dropdown-item github-link"
                                    >
                                        <GitHubLogoIcon /> GitHub
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
                            <h2>Move Document</h2>
                            <p>Select new parent folder for "{currentDocument?.title}"</p>
                            <div className="move-tree-container">
                                <DocumentTree
                                    documents={documents}
                                    currentDocPath={currentDocument?.path}
                                    onSelect={handleDocumentSelect}
                                    expandedNodes={expandedNodes}
                                    toggleExpand={toggleExpand}
                                    loadChildren={loadChildren}
                                    loadingParents={loadingParents}
                                    onCreateNewDocument={startCreateNewDocument} // Передаем обработчик
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
                                    Cancel
                                </button>
                                <button
                                    className="confirm-button"
                                    onClick={() => moveDocument(moveTargetId)}
                                    disabled={!moveTargetId || isLoading}
                                >
                                    {isLoading ? 'Moving...' : 'Move'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {showRestoreConfirm && (
                    <div className="modal-overlay">
                        <div className="modal">
                            <h2>Restore File State?</h2>
                            <p>The current state of the file will be saved in the history</p>
                            <div className="modal-buttons">
                                <button
                                    className="cancel-button"
                                    onClick={() => setShowRestoreConfirm(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    className="confirm-button"
                                    onClick={restoreHistoricalVersion}
                                    disabled={isLoading}
                                >
                                    {isLoading ? 'Restoring...' : 'OK'}
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
                            <div className="collapsed-sidebar-indicator">→</div>
                        ) : historyMode ? (
                            <HistoryList
                                history={documentHistory}
                                selectedCommit={selectedHistoryCommit}
                                onSelect={loadHistoricalDocument}
                            />
                        ) : isLoading ? (
                            <div className="loading">Loading...</div>
                        ) : (
                            <DocumentTree
                                documents={documents}
                                currentDocPath={currentDocument?.path}
                                onSelect={handleDocumentSelect}
                                expandedNodes={expandedNodes}
                                toggleExpand={toggleExpand}
                                loadChildren={loadChildren}
                                loadingParents={loadingParents}
                                onCreateNewDocument={startCreateNewDocument} // Передаем обработчик
                            />
                        )}
                    </div>

                    {!isMobile && (
                        <div
                            className="divider"
                            onMouseDown={startDrag}
                            style={{
                                display: isSidebarCollapsed ? 'none' : 'block',
                                cursor: isSidebarCollapsed ? 'default' : 'col-resize'
                            }}
                        />
                    )}

                    <div className="content">
                        {searchLoading ? (
                            <div className="loading">Searching...</div>
                        ) : searchError ? (
                            <div className="error">Search error: {searchError}</div>
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