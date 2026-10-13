// Russian UI strings. Keys are shared across catalogs.
// eslint-disable-next-line import/no-anonymous-default-export
export default {
    // Common
    'common.newDocument': 'Новый документ',
    'common.save': 'Сохранить',
    'common.cancel': 'Отмена',
    'common.create': 'Создать',
    'common.edit': 'Редактировать',
    'common.restore': 'Восстановить',
    'common.delete': 'Удалить',
    'common.move': 'Переместить',
    'common.history': 'История',
    'common.ok': 'OK',
    'common.remove': 'Убрать',
    'common.close': 'Закрыть',
    'common.home': 'На главную',
    'common.github': 'GitHub',

    // Save / loading status
    'status.saved': 'Сохранено',
    'status.saveError': 'Ошибка сохранения',
    'status.saving': 'Сохранение...',
    'status.creating': 'Создание...',
    'status.restoring': 'Восстановление...',
    'status.moving': 'Перемещение...',
    'loading.generic': 'Загрузка...',
    'loading.drafts': 'Загрузка черновиков...',
    'loading.last': 'Загрузка последних документов...',
    'loading.favorites': 'Загрузка избранного...',
    'loading.searching': 'Поиск...',

    // Root sections
    'sections.drafts': 'Черновики',
    'sections.lastViewed': 'Недавние',
    'sections.favorites': 'Избранное',
    'sections.noDrafts': 'Черновиков нет',
    'sections.noRecent': 'Нет недавних документов',
    'sections.noFavorites': 'Нет избранных документов',
    'sections.deleteDraft': 'Удалить черновик',
    'sections.removeFavorite': 'Убрать из избранного',
    'sections.path': 'Путь:',
    'sections.location': 'Расположение:',
    'sections.untitledDraft': 'Черновик без названия',
    'sections.editDraft': 'Редактирование черновика',

    // Confirmations
    'confirm.deleteDraft': 'Удалить этот черновик?',
    'confirm.deleteDocument': 'Удалить этот документ?',
    'confirm.deleteWithChildren': 'У документа есть дочерние документы. Удалить его вместе с ними?',

    // Search
    'search.placeholder': 'Поиск...',
    'search.resultsFor': 'Результаты поиска по запросу "{query}"',
    'search.windowTitle': 'Поиск: "{query}"',
    'search.noResults': 'Ничего не найдено',
    'search.previous': 'Назад',
    'search.next': 'Вперёд',
    'search.pageOf': 'Страница {page} из {total}',
    'search.error': 'Ошибка поиска: {message}',

    // History
    'history.title': 'История документа',
    'history.noCommitMessage': 'Без сообщения',

    // Document view
    'doc.unknownDate': 'Дата неизвестна',
    'doc.addToFavorites': 'Добавить в избранное',
    'doc.unsavedChanges': '• Есть несохранённые изменения',
    'doc.noContent': 'Документ пока не написан',
    'doc.childDocuments': 'Дочерние документы',

    // Editor
    'editor.placeholder': 'Начните печатать…',
    'editor.titlePlaceholder': 'Название документа',
    'editor.createNewDocument': 'Новый документ',
    'editor.uploadFailed': 'Не удалось загрузить файл',
    'editor.draftSavedAt': 'Редактирование черновика (сохранён {date})',

    // Move modal
    'move.title': 'Перемещение документа',
    'move.root': 'Корень',
    'move.selectParent': 'Выберите новую папку для "{title}"',

    // Restore modal
    'restore.title': 'Восстановить версию файла?',
    'restore.body': 'Текущее состояние файла будет сохранено в истории',

    // Notifications
    'notify.parentNotFound': 'Родительская папка не найдена, документ создан в корне',
    'notify.draftNotFound': 'Черновик не найден',
    'notify.failedSaveDraft': 'Не удалось сохранить черновик: {message}',

    // Toolbar
    'toolbar.formatting': 'Форматирование',
    'toolbar.h1': 'Заголовок 1 (Ctrl/Cmd+1)',
    'toolbar.h2': 'Заголовок 2 (Ctrl/Cmd+2)',
    'toolbar.h3': 'Заголовок 3 (Ctrl/Cmd+3)',
    'toolbar.bold': 'Полужирный (Ctrl/Cmd+B)',
    'toolbar.italic': 'Курсив (Ctrl/Cmd+I)',
    'toolbar.strike': 'Зачёркнутый (Ctrl/Cmd+Shift+X)',
    'toolbar.link': 'Ссылка (Ctrl/Cmd+K)',
    'toolbar.bulletList': 'Маркированный список (Ctrl/Cmd+8)',
    'toolbar.orderedList': 'Нумерованный список (Ctrl/Cmd+7)',
    'toolbar.taskList': 'Чек-лист (Ctrl/Cmd+9)',
    'toolbar.blockquote': 'Цитата (Ctrl/Cmd+Shift+.)',
    'toolbar.codeBlock': 'Блок кода (Ctrl/Cmd+Alt+C)',
    'toolbar.codeLanguage': 'Язык кода',
    'toolbar.divider': 'Разделитель (Ctrl/Cmd+Alt+H)',
    'toolbar.insertTable': 'Вставить таблицу',
    'toolbar.addRow': 'Добавить строку',
    'toolbar.addColumn': 'Добавить столбец',
    'toolbar.deleteRow': 'Удалить строку',
    'toolbar.deleteColumn': 'Удалить столбец',
    'toolbar.deleteTable': 'Удалить таблицу',
    'toolbar.undo': 'Отменить',
    'toolbar.redo': 'Повторить',
    'toolbar.linkText': 'Текст',
    'toolbar.linkUrl': 'Ссылка',
    'toolbar.linkTextPlaceholder': 'Текст ссылки',
};
