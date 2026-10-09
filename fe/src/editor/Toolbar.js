import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorState } from '@tiptap/react';
import { Link2Icon, ListBulletIcon, CheckboxIcon, QuoteIcon, CodeIcon, DividerHorizontalIcon, TableIcon } from '@radix-ui/react-icons';
import { HAS_SCHEME, isAttachmentHref, isSafeLinkHref } from './upload';
import { useI18n } from '../i18n';

// Links are always absolute: ya.ru -> https://ya.ru. Attachments (relative
// files next to the .md) are left untouched so the chip keeps working. Unsafe
// schemes (javascript:, data:) are rejected — an empty string unsets the link.
function toAbsoluteHref(raw) {
    const value = (raw || '').trim();
    if (value === '' || !isSafeLinkHref(value)) return '';
    if (HAS_SCHEME.test(value)) return value;
    return `https://${value}`;
}

const OrderedListIcon = () => (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <text x="0" y="6" fontSize="5.5" fill="currentColor" fontFamily="sans-serif">1</text>
        <text x="0" y="11" fontSize="5.5" fill="currentColor" fontFamily="sans-serif">2</text>
        <text x="0" y="16" fontSize="5.5" fill="currentColor" fontFamily="sans-serif">3</text>
        <rect x="6" y="2" width="10" height="1.4" fill="currentColor" />
        <rect x="6" y="7" width="10" height="1.4" fill="currentColor" />
        <rect x="6" y="12" width="10" height="1.4" fill="currentColor" />
    </svg>
);

function ToolButton({ onClick, active, disabled, title, children }) {
    return (
        <button
            type="button"
            className={`rte-tool${active ? ' is-active' : ''}`}
            onClick={onClick}
            disabled={disabled}
            title={title}
            aria-label={title}
            aria-pressed={typeof active === 'boolean' ? active : undefined}
        >
            {children}
        </button>
    );
}

const Divider = () => <span className="rte-tool-divider" />;

// Radix has no undo/redo glyphs — draw them like OrderedListIcon.
const UndoIcon = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 7v6h6" />
        <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
);

const RedoIcon = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 7v6h-6" />
        <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
    </svg>
);

const CODE_LANGUAGES = [
    ['', 'plain'],
    ['javascript', 'js'],
    ['typescript', 'ts'],
    ['jsx', 'jsx'],
    ['tsx', 'tsx'],
    ['json', 'json'],
    ['html', 'html'],
    ['css', 'css'],
    ['python', 'python'],
    ['go', 'go'],
    ['bash', 'bash'],
    ['sql', 'sql'],
    ['java', 'java'],
    ['c', 'c'],
    ['cpp', 'cpp'],
    ['rust', 'rust'],
    ['yaml', 'yaml'],
    ['markdown', 'md'],
];

export default function Toolbar({ editor }) {
    const { t } = useI18n();
    const [linkOpen, setLinkOpen] = useState(false);
    const [linkText, setLinkText] = useState('');
    const [linkUrl, setLinkUrl] = useState('');
    const popoverRef = useRef(null);
    const urlInputRef = useRef(null);

    const openLinkMenu = useCallback(() => {
        // If the cursor is inside a link, select the whole link to edit/replace it.
        if (editor.isActive('link')) {
            editor.chain().extendMarkRange('link').run();
        }
        const { from, to, empty } = editor.state.selection;
        const href = editor.getAttributes('link').href || '';
        const selected = empty ? '' : editor.state.doc.textBetween(from, to, ' ');
        setLinkText(selected);
        setLinkUrl(href || selected);
        setLinkOpen(true);
    }, [editor]);

    useEffect(() => {
        if (!editor) return undefined;
        editor.on('rte:openLink', openLinkMenu);
        return () => editor.off('rte:openLink', openLinkMenu);
    }, [editor, openLinkMenu]);

    // Close the popover on outside click and Escape.
    useEffect(() => {
        if (!linkOpen) return undefined;
        const onPointerDown = (e) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target)) setLinkOpen(false);
        };
        const onKeyDown = (e) => {
            if (e.key === 'Escape') setLinkOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [linkOpen]);

    useEffect(() => {
        if (linkOpen) urlInputRef.current?.focus();
    }, [linkOpen]);

    const state = useEditorState({
        editor,
        selector: ({ editor }) => {
            if (!editor) return null;
            return {
                h1: editor.isActive('heading', { level: 1 }),
                h2: editor.isActive('heading', { level: 2 }),
                h3: editor.isActive('heading', { level: 3 }),
                bold: editor.isActive('bold'),
                italic: editor.isActive('italic'),
                strike: editor.isActive('strike'),
                link: editor.isActive('link'),
                bulletList: editor.isActive('bulletList'),
                orderedList: editor.isActive('orderedList'),
                taskList: editor.isActive('taskList'),
                blockquote: editor.isActive('blockquote'),
                codeBlock: editor.isActive('codeBlock'),
                language: editor.getAttributes('codeBlock').language || '',
                table: editor.isActive('table'),
                canUndo: editor.can().undo(),
                canRedo: editor.can().redo(),
            };
        },
    });

    if (!editor || !state) return null;
    const chain = () => editor.chain().focus();

    const applyLink = () => {
        const existingHref = editor.getAttributes('link').href || '';
        const href = isAttachmentHref(existingHref) ? linkUrl.trim() : toAbsoluteHref(linkUrl);
        const text = linkText.trim() || href;

        if (href === '') {
            chain().extendMarkRange('link').unsetLink().run();
            setLinkOpen(false);
            return;
        }

        const { from, to, empty } = editor.state.selection;
        if (empty) {
            chain().insertContent({
                type: 'text',
                text,
                marks: [{ type: 'link', attrs: { href } }],
            }).run();
        } else if (text !== editor.state.doc.textBetween(from, to, ' ')) {
            chain().insertContentAt({ from, to }, {
                type: 'text',
                text,
                marks: [{ type: 'link', attrs: { href } }],
            }).run();
        } else {
            chain().extendMarkRange('link').setLink({ href }).run();
        }
        setLinkOpen(false);
    };

    return (
        <div className="rte-toolbar">
            <div className="rte-toolbar-row" role="toolbar" aria-label={t('toolbar.formatting')}>
                <ToolButton title={t('toolbar.h1')} active={state.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()}>H1</ToolButton>
                <ToolButton title={t('toolbar.h2')} active={state.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}>H2</ToolButton>
                <ToolButton title={t('toolbar.h3')} active={state.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}>H3</ToolButton>
                <Divider />
                <ToolButton title={t('toolbar.bold')} active={state.bold} onClick={() => chain().toggleBold().run()}><b>B</b></ToolButton>
                <ToolButton title={t('toolbar.italic')} active={state.italic} onClick={() => chain().toggleItalic().run()}><i>I</i></ToolButton>
                <ToolButton title={t('toolbar.strike')} active={state.strike} onClick={() => chain().toggleStrike().run()}><s>S</s></ToolButton>
                <ToolButton title={t('toolbar.link')} active={state.link} onClick={openLinkMenu}><Link2Icon /></ToolButton>
                <Divider />
                <ToolButton title={t('toolbar.bulletList')} active={state.bulletList} onClick={() => chain().toggleBulletList().run()}><ListBulletIcon /></ToolButton>
                <ToolButton title={t('toolbar.orderedList')} active={state.orderedList} onClick={() => chain().toggleOrderedList().run()}><OrderedListIcon /></ToolButton>
                <ToolButton title={t('toolbar.taskList')} active={state.taskList} onClick={() => chain().toggleTaskList().run()}><CheckboxIcon /></ToolButton>
                <Divider />
                <ToolButton title={t('toolbar.blockquote')} active={state.blockquote} onClick={() => chain().toggleBlockquote().run()}><QuoteIcon /></ToolButton>
                <ToolButton title={t('toolbar.codeBlock')} active={state.codeBlock} onClick={() => chain().toggleCodeBlock().run()}><CodeIcon /></ToolButton>
                {state.codeBlock && (
                    <select
                        className="rte-lang-select"
                        title={t('toolbar.codeLanguage')}
                        aria-label={t('toolbar.codeLanguage')}
                        value={state.language}
                        onChange={(e) => chain().updateAttributes('codeBlock', { language: e.target.value }).run()}
                    >
                        {CODE_LANGUAGES.map(([value, label]) => (
                            <option key={value || 'plain'} value={value}>{label}</option>
                        ))}
                    </select>
                )}
                <ToolButton title={t('toolbar.divider')} onClick={() => chain().setHorizontalRule().run()}><DividerHorizontalIcon /></ToolButton>
                <Divider />
                <ToolButton
                    title={t('toolbar.insertTable')}
                    active={state.table}
                    onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
                >
                    <TableIcon />
                </ToolButton>
                {state.table && (
                    <>
                        <ToolButton title={t('toolbar.addRow')} onClick={() => chain().addRowAfter().run()}>+Row</ToolButton>
                        <ToolButton title={t('toolbar.addColumn')} onClick={() => chain().addColumnAfter().run()}>+Col</ToolButton>
                        <ToolButton title={t('toolbar.deleteRow')} onClick={() => chain().deleteRow().run()}>-Row</ToolButton>
                        <ToolButton title={t('toolbar.deleteColumn')} onClick={() => chain().deleteColumn().run()}>-Col</ToolButton>
                        <ToolButton title={t('toolbar.deleteTable')} onClick={() => chain().deleteTable().run()}>-Table</ToolButton>
                    </>
                )}
                <Divider />
                <ToolButton title={t('toolbar.undo')} disabled={!state.canUndo} onClick={() => chain().undo().run()}><UndoIcon /></ToolButton>
                <ToolButton title={t('toolbar.redo')} disabled={!state.canRedo} onClick={() => chain().redo().run()}><RedoIcon /></ToolButton>
            </div>

            {linkOpen && (
                <div className="rte-link-popover" ref={popoverRef} role="dialog" aria-label={t('toolbar.link')}>
                    <label className="rte-link-field">
                        <span>{t('toolbar.linkText')}</span>
                        <input
                            type="text"
                            className="rte-link-input"
                            placeholder={t('toolbar.linkTextPlaceholder')}
                            value={linkText}
                            onChange={(e) => setLinkText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') applyLink();
                                if (e.key === 'Escape') setLinkOpen(false);
                            }}
                        />
                    </label>
                    <label className="rte-link-field">
                        <span>{t('toolbar.linkUrl')}</span>
                        <input
                            type="text"
                            className="rte-link-input"
                            ref={urlInputRef}
                            placeholder="https://…"
                            value={linkUrl}
                            onChange={(e) => setLinkUrl(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') applyLink();
                                if (e.key === 'Escape') setLinkOpen(false);
                            }}
                        />
                    </label>
                    <div className="rte-link-actions">
                        <button type="button" onClick={applyLink}>OK</button>
                        <button
                            type="button"
                            onClick={() => {
                                chain().extendMarkRange('link').unsetLink().run();
                                setLinkOpen(false);
                            }}
                        >
                            {t('common.remove')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
