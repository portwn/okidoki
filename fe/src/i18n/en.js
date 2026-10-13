// English UI strings. Keys are shared across catalogs.
// eslint-disable-next-line import/no-anonymous-default-export
export default {
    // Common
    'common.newDocument': 'New Document',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.create': 'Create',
    'common.edit': 'Edit',
    'common.restore': 'Restore',
    'common.delete': 'Delete',
    'common.move': 'Move',
    'common.history': 'History',
    'common.ok': 'OK',
    'common.remove': 'Remove',
    'common.close': 'Close',
    'common.home': 'Home',
    'common.github': 'GitHub',

    // Save / loading status
    'status.saved': 'Saved',
    'status.saveError': 'Save error',
    'status.saving': 'Saving...',
    'status.creating': 'Creating...',
    'status.restoring': 'Restoring...',
    'status.moving': 'Moving...',
    'loading.generic': 'Loading...',
    'loading.drafts': 'Loading drafts...',
    'loading.last': 'Loading last documents...',
    'loading.favorites': 'Loading favorites...',
    'loading.searching': 'Searching...',

    // Root sections
    'sections.drafts': 'Drafts',
    'sections.lastViewed': 'Last Viewed',
    'sections.favorites': 'Favorites',
    'sections.noDrafts': 'No drafts found',
    'sections.noRecent': 'No recent documents',
    'sections.noFavorites': 'No favorite documents',
    'sections.deleteDraft': 'Delete draft',
    'sections.removeFavorite': 'Remove from favorites',
    'sections.path': 'Path:',
    'sections.location': 'Location:',
    'sections.untitledDraft': 'Untitled Draft',
    'sections.editDraft': 'Edit Draft',

    // Confirmations
    'confirm.deleteDraft': 'Are you sure you want to delete this draft?',
    'confirm.deleteDocument': 'Are you sure you want to delete this document?',
    'confirm.deleteWithChildren': 'The document has child documents. Delete it together with them?',

    // Search
    'search.placeholder': 'Search...',
    'search.resultsFor': 'Search Results for "{query}"',
    'search.windowTitle': 'Search: "{query}"',
    'search.noResults': 'No results found',
    'search.previous': 'Previous',
    'search.next': 'Next',
    'search.pageOf': 'Page {page} of {total}',
    'search.error': 'Search error: {message}',

    // History
    'history.title': 'Document History',
    'history.noCommitMessage': 'No commit message',

    // Document view
    'doc.unknownDate': 'Unknown date',
    'doc.addToFavorites': 'Add to favorites',
    'doc.unsavedChanges': '• Have unsaved changes',
    'doc.noContent': 'This document is not written yet',
    'doc.childDocuments': 'Child documents',

    // Editor
    'editor.placeholder': 'Start typing…',
    'editor.titlePlaceholder': 'Document title',
    'editor.createNewDocument': 'Create New Document',
    'editor.uploadFailed': 'Upload failed',
    'editor.draftSavedAt': 'Editing draft (saved {date})',

    // Move modal
    'move.title': 'Move Document',
    'move.root': 'Root',
    'move.selectParent': 'Select new parent folder for "{title}"',

    // Restore modal
    'restore.title': 'Restore File State?',
    'restore.body': 'The current state of the file will be saved in the history',

    // Notifications
    'notify.parentNotFound': 'Parent directory not found, created in root',
    'notify.draftNotFound': 'Draft not found',
    'notify.failedSaveDraft': 'Failed to save draft: {message}',

    // Toolbar
    'toolbar.formatting': 'Formatting',
    'toolbar.h1': 'Heading 1 (Ctrl/Cmd+1)',
    'toolbar.h2': 'Heading 2 (Ctrl/Cmd+2)',
    'toolbar.h3': 'Heading 3 (Ctrl/Cmd+3)',
    'toolbar.bold': 'Bold (Ctrl/Cmd+B)',
    'toolbar.italic': 'Italic (Ctrl/Cmd+I)',
    'toolbar.strike': 'Strikethrough (Ctrl/Cmd+Shift+X)',
    'toolbar.link': 'Link (Ctrl/Cmd+K)',
    'toolbar.bulletList': 'Bullet list (Ctrl/Cmd+8)',
    'toolbar.orderedList': 'Numbered list (Ctrl/Cmd+7)',
    'toolbar.taskList': 'Checklist (Ctrl/Cmd+9)',
    'toolbar.blockquote': 'Quote (Ctrl/Cmd+Shift+.)',
    'toolbar.codeBlock': 'Code block (Ctrl/Cmd+Alt+C)',
    'toolbar.codeLanguage': 'Code language',
    'toolbar.divider': 'Divider (Ctrl/Cmd+Alt+H)',
    'toolbar.insertTable': 'Insert table',
    'toolbar.addRow': 'Add row',
    'toolbar.addColumn': 'Add column',
    'toolbar.deleteRow': 'Delete row',
    'toolbar.deleteColumn': 'Delete column',
    'toolbar.deleteTable': 'Delete table',
    'toolbar.undo': 'Undo',
    'toolbar.redo': 'Redo',
    'toolbar.linkText': 'Text',
    'toolbar.linkUrl': 'Link',
    'toolbar.linkTextPlaceholder': 'Link text',
};
