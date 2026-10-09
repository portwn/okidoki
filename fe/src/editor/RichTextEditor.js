import React, {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
} from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import Toolbar from './Toolbar';
import { buildExtensions } from './extensions';
import { isAttachmentHref, isSafeLinkHref, registerAttachment } from './upload';
import './editor.css';

// Download without opening a new tab: fetch the file into a blob and hand it
// to the browser via <a download> (more reliable than direct navigation/window.open).
async function triggerDownload(url, filename) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`download failed: ${response.status}`);
        const objectUrl = URL.createObjectURL(await response.blob());
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename || '';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            URL.revokeObjectURL(objectUrl);
            a.remove();
        }, 4000);
    } catch (e) {
        console.error('attachment download failed:', e);
    }
}

const RichTextEditor = forwardRef(function RichTextEditor({
    value = '',
    onChange,
    placeholder,
    editable = true,
    onUploadFile,
    onUploadError,
    resolveAsset,
    className = '',
}, ref) {
    const propsRef = useRef({ onChange, onUploadFile, onUploadError, resolveAsset });
    propsRef.current = { onChange, onUploadFile, onUploadError, resolveAsset };

    const editorRef = useRef(null);
    const lastEmitted = useRef(value);

    const runUpload = useCallback(async (files) => {
        const editor = editorRef.current;
        const upload = propsRef.current.onUploadFile;
        if (!editor || !upload || !files || files.length === 0) return;

        for (const file of Array.from(files)) {
            // Remember the position before the async upload: by the time the
            // response arrives the cursor may have moved, so insert where dropped.
            const insertAt = editor.state.selection.from;
            let result;
            try {
                result = await upload(file);
            } catch (e) {
                console.error('upload failed:', e);
                propsRef.current.onUploadError?.(e);
                continue;
            }
            if (!result || editor.isDestroyed) continue;

            registerAttachment(result.name);

            const content = result.isImage
                ? { type: 'image', attrs: { src: result.path, alt: result.name } }
                : {
                    type: 'text',
                    text: result.name,
                    marks: [{ type: 'link', attrs: { href: result.path } }],
                };
            const pos = Math.min(insertAt, editor.state.doc.content.size);
            editor.chain().focus().insertContentAt(pos, content).run();
        }
    }, []);

    // The editor scrolls its own body (.rte-editor), but the outer area (.edit-container)
    // that hides the title may remain scrolled up. Keep the caret visible
    // on screen by nudging the outer container.
    const scrollCaretIntoView = useCallback((editor) => {
        if (!editor) return;
        const scroller = editor.view.dom.closest('.edit-container');
        if (!scroller) return;
        let coords;
        try {
            coords = editor.view.coordsAtPos(editor.state.selection.head);
        } catch (e) {
            return;
        }
        const rect = scroller.getBoundingClientRect();
        const margin = 16;
        let delta = 0;
        if (coords.bottom > rect.bottom - margin) {
            delta = coords.bottom - (rect.bottom - margin);
        } else if (coords.top < rect.top + margin) {
            delta = coords.top - (rect.top + margin);
        }
        if (delta) scroller.scrollTop += delta;
    }, []);

    // Caret scroll via requestAnimationFrame to avoid a synchronous
    // layout on every keystroke; calls are coalesced.
    const scrollRaf = useRef(null);
    const scheduleScroll = useCallback(() => {
        if (scrollRaf.current) return;
        scrollRaf.current = requestAnimationFrame(() => {
            scrollRaf.current = null;
            scrollCaretIntoView(editorRef.current);
        });
    }, [scrollCaretIntoView]);

    const editor = useEditor({
        editable,
        extensions: buildExtensions({ placeholder, resolveAsset }),
        content: value || '',
        contentType: 'markdown',
        editorProps: {
            attributes: { class: 'rte-content' },
            handlePaste: (view, event) => {
                const files = event.clipboardData?.files;
                if (files && files.length > 0) {
                    event.preventDefault();
                    runUpload(files);
                    return true;
                }
                return false;
            },
            handleDrop: (view, event) => {
                const files = event.dataTransfer?.files;
                if (files && files.length > 0) {
                    event.preventDefault();
                    runUpload(files);
                    return true;
                }
                return false;
            },
            handleClick: (view, pos, event) => {
                // In read mode a link opens on a normal click;
                // in the editor, only on Ctrl/Cmd + click.
                if (view.editable && !(event.ctrlKey || event.metaKey)) return false;
                const link = event.target.closest?.('a[href]');
                if (!link) return false;
                event.preventDefault();
                const href = link.getAttribute('href') || '';
                if (!isSafeLinkHref(href)) return true;
                const resolve = propsRef.current.resolveAsset;
                const url = resolve ? resolve(href) : href;
                if (isAttachmentHref(href)) {
                    triggerDownload(url, href.split('#')[0].split('/').pop());
                } else {
                    window.open(url, '_blank', 'noopener,noreferrer');
                }
                return true;
            },
        },
        onUpdate: ({ editor }) => {
            const markdown = editor.getMarkdown();
            lastEmitted.current = markdown;
            propsRef.current.onChange?.(markdown);
            scheduleScroll();
        },
        onSelectionUpdate: () => {
            scheduleScroll();
        },
    });

    useEffect(() => {
        editorRef.current = editor;
    }, [editor]);

    useEffect(() => () => {
        if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
    }, []);

    // External value change (loading another document) — sync the content.
    useEffect(() => {
        if (!editor) return;
        if (value === lastEmitted.current) return;
        if (value === editor.getMarkdown()) return;
        editor.commands.setContent(value || '', { contentType: 'markdown', emitUpdate: false });
        lastEmitted.current = value;
    }, [editor, value]);

    useEffect(() => {
        if (editor) editor.setEditable(editable);
    }, [editor, editable]);

    useImperativeHandle(ref, () => ({
        focus: () => editor?.chain().focus().run(),
        setContent: (markdown) =>
            editor?.commands.setContent(markdown || '', { contentType: 'markdown', emitUpdate: false }),
        clearSelection: () => editor?.commands.blur(),
        getEditor: () => editor,
    }), [editor]);

    if (!editor) {
        return <div className={`rte ${className}`.trim()}><div className="rte-loading" /></div>;
    }

    return (
        <div className={`rte${editable ? '' : ' is-readonly'} ${className}`.trim()}>
            {editable && <Toolbar editor={editor} />}
            <EditorContent editor={editor} className="rte-editor" />
        </div>
    );
});

export default RichTextEditor;
