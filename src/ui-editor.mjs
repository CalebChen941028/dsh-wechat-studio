function TopBar(props) {
  const { store, design, features, narrow, compact, narrowView, setNarrowView, rightOpen, setRightOpen, onCompose, onReshuffle, onCopy, onOpenDesign, onImportDocument, refining, toast, appearance, setAppearance } = props
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [appearanceOpen, setAppearanceOpen] = React.useState(false)
  React.useEffect(() => {
    if (!appearanceOpen && !menuOpen) return undefined
    const onPointerDown = (event) => {
      const target = event.target
      if (target instanceof Element && target.closest('.ws-menu-anchor') !== null) return
      setAppearanceOpen(false)
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown, true)
    return () => document.removeEventListener('mousedown', onPointerDown, true)
  }, [appearanceOpen, menuOpen])
  const fileRef = React.useRef(null)

  const exportHtml = () => {
    const tree = buildArticle({
      blocks: parseArticle(expandImageRefs(store.doc.text)).blocks,
      design,
      meta: { title: store.doc.meta.title, author: store.doc.meta.author, date: formatDate(store.doc.updatedAt), readingMinutes: features.readingMinutes },
    })
    downloadFile(`${(store.doc.meta.title || 'wechat-article').slice(0, 40)}.html`, serializeNodes(tree.nodes), 'text/html;charset=utf-8')
    setMenuOpen(false)
  }
  const exportMarkdown = () => {
    downloadFile(`${(store.doc.meta.title || 'wechat-article').slice(0, 40)}.md`, expandImageRefs(store.doc.text), 'text/markdown;charset=utf-8')
    setMenuOpen(false)
  }
  const exportJson = () => {
    downloadFile('wechat-studio-draft.json', JSON.stringify({ ...store.doc, text: expandImageRefs(store.doc.text) }, null, 2), 'application/json;charset=utf-8')
    setMenuOpen(false)
  }
  const importFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      if (!/\.json$/i.test(file.name)) {
        onImportDocument(file)
        return
      }
      const content = await file.text()
      const parsed = JSON.parse(content)
      if (!parsed || typeof parsed.text !== 'string') throw new Error(t('这个 JSON 里没有可用的正文'))
      const importedText = await materializeInlineImages(parsed.text, { kind: 'import' })
      bumpImages()
      store.addDoc(importedText, parsed.design, parsed.meta)
      toast(`已导入「${parsed.meta?.title || t('未命名草稿')}」`, 'success')
    } catch (error) {
      toast(error.message || t('导入失败'), 'error')
    }
  }

  return h('header', { className: 'ws-top' },
    h('div', { className: 'ws-brand' },
      h(Icon, { name: 'pen', size: 17 }),
      h('span', null, t('公众号排版')),
      compact ? null : h('span', { className: 'ws-badge' }, design.themeName + ' · ' + design.variantName),
      refining ? h('span', { className: 'ws-badge busy' }, t('AI 精排中…')) : null,
    ),
    narrow
      ? h('div', { className: 'ws-seg' },
        h('button', { type: 'button', className: narrowView === 'write' ? 'on' : '', onClick: () => setNarrowView('write') }, t('编辑')),
        h('button', { type: 'button', className: narrowView === 'preview' ? 'on' : '', onClick: () => setNarrowView('preview') }, t('预览')),
        h('button', { type: 'button', className: narrowView === 'design' ? 'on' : '', onClick: () => setNarrowView('design') }, t('设计')),
      )
      : null,
    h('div', { className: 'ws-top-spacer' }),
    !narrow
      ? h('div', { className: 'ws-top-group' },
        h(IconButton, { icon: 'undo', title: t('撤销'), disabled: !store.canUndo, onClick: store.undo }),
        h(IconButton, { icon: 'redo', title: t('重做'), disabled: !store.canRedo, onClick: store.redo }),
      )
      : null,
    compact
      ? h(IconButton, { icon: 'chat', title: t('AI 对话修改'), onClick: () => onOpenDesign('ai') })
      : h(Button, { icon: 'chat', onClick: () => onOpenDesign('ai'), title: t('用对话让 AI 改文案或版式') }, t('AI 修改')),
    h(Button, { icon: 'sparkles', variant: 'primary', onClick: onCompose, title: t('按内容自动选择主题与版式') }, t('自动编排')),
    compact
      ? h(IconButton, { icon: 'shuffle', title: t('换一版'), onClick: onReshuffle })
      : h(Button, { icon: 'shuffle', onClick: onReshuffle, title: t('在当前主题里换一个版式') }, t('换一版')),
    compact
      ? h(IconButton, { icon: 'copy', title: t('复制带样式的正文'), onClick: onCopy })
      : h(Button, { icon: 'copy', onClick: onCopy }, t('复制 HTML')),
    h(Button, { icon: 'send', variant: 'solid', onClick: () => onOpenDesign('publish') }, t('发布')),
    narrow
      ? null
      : h(IconButton, { icon: 'panel', title: rightOpen ? t('收起设计面板') : t('展开设计面板'), onClick: () => setRightOpen(value => !value) }),
    h('div', { className: 'ws-menu-anchor' },
      h(IconButton, { icon: 'palette', title: t('外观与主题'), onClick: () => { setAppearanceOpen(value => !value); setMenuOpen(false) } }),
      appearanceOpen
        ? h('div', { className: 'ws-appearance' },
          h('div', { className: 'ws-appearance-head' }, h(Icon, { name: 'palette', size: 14 }), h('span', null, t('外观'))),
          h('div', { className: 'ws-skins' },
            SKINS.map(skin => h('button', {
              key: skin.id,
              type: 'button',
              className: 'ws-skin' + (appearance.skin === skin.id ? ' on' : '') + ' ws-skin-' + skin.id,
              onClick: () => setAppearance({ ...appearance, skin: skin.id }),
            },
            h('span', { className: 'ws-skin-preview' }),
            h('span', { className: 'ws-skin-text' },
              h('span', { className: 'ws-skin-name' }, skin.name),
              h('span', { className: 'ws-skin-hint' }, skin.hint),
            ),
            )),
          ),
          h('div', { className: 'ws-appearance-sub' }, t('强调色')),
          h('div', { className: 'ws-swatches' },
            UI_ACCENTS.map(color => h('button', {
              key: color,
              type: 'button',
              className: 'ws-swatch' + (appearance.accent.toLowerCase() === color.toLowerCase() ? ' on' : ''),
              style: { background: color },
              title: color,
              onClick: () => setAppearance({ ...appearance, accent: color }),
            })),
          ),
          h('div', { className: 'ws-appearance-sub' }, t('界面语言')),
          h('div', { className: 'ws-device-switch ws-lang-switch' },
            [['', t('跟随应用')], ['zh', t('中文')], ['en', 'English']].map(([value, label]) => {
              let current = ''
              try { current = window.localStorage.getItem('dsh.wechat-studio.uiLang') ?? '' } catch { current = '' }
              return h('button', {
                key: value === '' ? 'auto' : value,
                type: 'button',
                className: 'ws-device-btn' + (current === value ? ' on' : ''),
                onClick: () => {
                  try {
                    if (value === '') window.localStorage.removeItem('dsh.wechat-studio.uiLang')
                    else window.localStorage.setItem('dsh.wechat-studio.uiLang', value)
                  } catch { /* private mode */ }
                  window.location.reload()
                },
              }, label)
            }),
          ),
        )
        : null,
    ),
    h('div', { className: 'ws-menu-anchor' },
      h(IconButton, { icon: 'more', title: t('更多'), onClick: () => { setMenuOpen(value => !value); setAppearanceOpen(false) } }),
      menuOpen
        ? h('div', { className: 'ws-menu', onMouseLeave: () => setMenuOpen(false) },
          h('button', { type: 'button', onClick: exportHtml }, h(Icon, { name: 'download', size: 14 }), t('导出 HTML')),
          h('button', { type: 'button', onClick: exportMarkdown }, h(Icon, { name: 'download', size: 14 }), t('导出 Markdown')),
          h('button', { type: 'button', onClick: exportJson }, h(Icon, { name: 'download', size: 14 }), t('导出草稿 JSON')),
          h('button', { type: 'button', onClick: () => fileRef.current?.click() }, h(Icon, { name: 'upload', size: 14 }), t('导入 .md / .txt / .json')),
          h('div', { className: 'ws-menu-sep' }),
          h('button', { type: 'button', className: 'danger', onClick: () => { setMenuOpen(false); store.removeDoc(store.doc.id); toast(t('草稿已删除')) } }, h(Icon, { name: 'trash', size: 14 }), t('删除当前草稿')),
        )
        : null,
    ),
    h('input', { ref: fileRef, type: 'file', accept: '.md,.markdown,.txt,.json,.docx,.html,.htm', style: { display: 'none' }, onChange: importFile }),
  )
}

/* ------------------------------------------------------------------ *
 * Left rail: drafts, title, toolbar, editor
 * ------------------------------------------------------------------ */

function DocRail(props) {
  const { store, parsed, features, textareaRef, toast, selectedBlock, setSelectedBlock, onGoToBlock, onEditorCaret, onImportDocument, onContentPasted, onOpenAi, onImagesChanged } = props
  const { doc } = store
  const [docMenu, setDocMenu] = React.useState(false)
  React.useEffect(() => {
    if (!docMenu) return undefined
    const onPointerDown = (event) => {
      const target = event.target
      if (target instanceof Element && target.closest('.ws-doc-switch') !== null) return
      setDocMenu(false)
    }
    document.addEventListener('mousedown', onPointerDown, true)
    return () => document.removeEventListener('mousedown', onPointerDown, true)
  }, [docMenu])
  const [dragging, setDragging] = React.useState(false)
  const [formats, setFormats] = React.useState({ heading: 0, list: '', quote: false, bold: false, highlight: false })
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [findText, setFindText] = React.useState('')
  const [replaceText, setReplaceText] = React.useState('')
  const uploadRef = React.useRef(null)
  const imageRef = React.useRef(null)

  const insert = (before, after = '', placeholder = '') => {
    const element = textareaRef.current
    if (!element) return
    const start = element.selectionStart
    const end = element.selectionEnd
    const selected = doc.text.slice(start, end) || placeholder
    const next = `${doc.text.slice(0, start)}${before}${selected}${after}${doc.text.slice(end)}`
    store.updateDoc(current => ({ ...current, text: next }), { coalesce: 'insert' })
    requestAnimationFrame(() => {
      element.focus()
      element.selectionStart = start + before.length
      element.selectionEnd = start + before.length + selected.length
    })
  }

  const insertText = (snippet) => {
    const element = textareaRef.current
    if (!element) return
    const start = element.selectionStart
    const end = element.selectionEnd
    const next = `${doc.text.slice(0, start)}${snippet}${doc.text.slice(end)}`
    store.updateDoc(current => ({ ...current, text: next }), { coalesce: 'insert' })
    requestAnimationFrame(() => {
      element.focus()
      const caret = start + snippet.length
      element.selectionStart = caret
      element.selectionEnd = caret
    })
  }

  const insertImageFile = async (file) => {
    if (!file) return
    try {
      const raw = await readFileAsDataUrl(file)
      const compressed = await compressImage(raw, 720)
      const alt = String(file.name ?? t('配图')).replace(/\.[^.]+$/, '') || t('配图')
      const ref = await materializeImage(compressed.dataUrl, { kind: 'content' })
      insertText(`\n\n![${alt}](${ref})\n\n`)
      if (typeof onImagesChanged === 'function') onImagesChanged()
      toast('图片已插入正文，发布时会自动转存到微信 CDN', 'success')
    } catch (error) {
      toast(error.message || t('图片处理失败'), 'error')
    }
  }

  const insertBlock = (snippet) => {
    const element = textareaRef.current
    if (!element) return
    const position = element.selectionStart
    const before = doc.text.slice(0, position)
    const needsGap = before !== '' && !before.endsWith('\n\n')
    const prefix = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
    void needsGap
    const next = `${before}${prefix}${snippet}\n\n${doc.text.slice(position)}`
    store.updateDoc(current => ({ ...current, text: next }), { coalesce: 'insert' })
    requestAnimationFrame(() => {
      element.focus()
      const caret = before.length + prefix.length + snippet.length
      element.selectionStart = caret
      element.selectionEnd = caret
    })
  }

  const transformLines = (transform) => {
    const element = textareaRef.current
    if (!element) return
    const value = doc.text
    const startLine = value.lastIndexOf('\n', Math.max(0, element.selectionStart - 1)) + 1
    let endLine = value.indexOf('\n', element.selectionEnd)
    if (endLine === -1) endLine = value.length
    const before = value.slice(0, startLine)
    const block = value.slice(startLine, endLine)
    const after = value.slice(endLine)
    const lines = block.split('\n').map(transform)
    const next = before + lines.join('\n') + after
    store.updateDoc(current => ({ ...current, text: next }), { coalesce: 'insert' })
    requestAnimationFrame(() => {
      element.focus()
      element.selectionStart = startLine
      element.selectionEnd = startLine + lines.join('\n').length
    })
  }

  const toggleHeading = (level) => {
    transformLines((line) => {
      const plain = line.replace(/^#{1,6}\s+/, '')
      const already = new RegExp(`^${'#'.repeat(level)}\s`).test(line)
      return already ? plain : `${'#'.repeat(level)} ${plain}`
    })
  }

  const toggleList = (ordered) => {
    transformLines((line) => {
      const plain = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
      const alreadyOrdered = /^\s*\d+[.)]\s/.test(line)
      const alreadyBullet = /^\s*[-*+]\s/.test(line)
      if (ordered && alreadyOrdered) return plain
      if (!ordered && alreadyBullet) return plain
      return `${ordered ? '1.' : '-'} ${plain}`
    })
  }

  const handleEditorSelect = (event) => {
    if (typeof onEditorCaret === 'function') onEditorCaret(event)
    const element = event.currentTarget
    const value = element.value
    const start = element.selectionStart
    const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
    let lineEnd = value.indexOf('\n', start)
    if (lineEnd === -1) lineEnd = value.length
    const line = value.slice(lineStart, lineEnd)
    const heading = (line.match(/^(#{1,6})\s/) ?? [])[1]?.length ?? 0
    const list = /^\s*\d+[.)]\s/.test(line) ? 'ol' : /^\s*[-*+]\s/.test(line) ? 'ul' : ''
    const quote = /^\s*>/.test(line)
    const before = value.slice(0, start)
    const after = value.slice(element.selectionEnd)
    const bold = (before.match(/\*\*/g) ?? []).length % 2 === 1 && after.includes('**')
    const highlight = (before.match(/==/g) ?? []).length % 2 === 1 && after.includes('==')
    setFormats({ heading, list, quote, bold, highlight })
  }

  const findNext = () => {
    if (findText === '') return
    const element = textareaRef.current
    if (!element) return
    let index = doc.text.indexOf(findText, element.selectionEnd)
    if (index === -1) index = doc.text.indexOf(findText)
    if (index === -1) { toast(t('没有找到匹配内容'), 'error'); return }
    element.focus()
    element.setSelectionRange(index, index + findText.length)
    element.scrollTop = Math.max(0, doc.text.slice(0, index).split('\n').length * 20 - element.clientHeight / 3)
  }
  const replaceOne = () => {
    if (findText === '') return
    const element = textareaRef.current
    if (element && doc.text.slice(element.selectionStart, element.selectionEnd) === findText) {
      const next = doc.text.slice(0, element.selectionStart) + replaceText + doc.text.slice(element.selectionEnd)
      store.updateDoc(current => ({ ...current, text: next }), { coalesce: 'replace' })
      requestAnimationFrame(() => {
        const at = element.selectionStart
        element.setSelectionRange(at, at + replaceText.length)
      })
      return
    }
    findNext()
  }
  const replaceAll = () => {
    if (findText === '') return
    const count = doc.text.split(findText).length - 1
    if (count === 0) { toast(t('没有找到匹配内容'), 'error'); return }
    store.updateDoc(current => ({ ...current, text: current.text.split(findText).join(replaceText) }), { coalesce: 'replace' })
    toast(t('已替换 {count} 处', { count }))
  }

  const words = features.chars
  const outline = parsed.blocks
    .filter(block => block.type !== 'title')
    .map((block, index) => ({ block, index }))
    .filter(entry => entry.block.type === 'heading')
  const toolbar = [
    { label: 'H2', title: `${t('小节标题')} (⌘2)`, run: () => toggleHeading(2), format: 'h2' },
    { label: 'H3', title: `${t('小标题')} (⌘3)`, run: () => toggleHeading(3), format: 'h3' },
    { label: '“', title: `${t('引用')} (⌘⇧.)`, run: () => insertBlock(t('> 写一句值得被记住的话')), format: 'quote' },
    { label: '•', title: `${t('无序列表')} (⌘⇧7)`, run: () => toggleList(false), format: 'ul' },
    { label: '1.', title: `${t('有序列表')} (⌘⇧8)`, run: () => toggleList(true), format: 'ol' },
    { label: '—', title: t('分割线'), run: () => insertBlock('---') },
    { label: t('图'), title: t('插入本地图片'), run: () => imageRef.current?.click() },
    { label: 'B', title: `${t('加粗')} (⌘B)`, run: () => insert('**', '**', t('加粗文字')), format: 'bold' },
    { label: t('高'), title: `${t('高亮')} (⌘⇧H)`, run: () => insert('==', '==', t('高亮文字')), format: 'hl' },
    { label: t('码'), title: t('行内代码'), run: () => insert('`', '`', 'code') },
  ]

  return h('aside', {
    className: 'ws-left' + (dragging ? ' ws-dragging' : ''),
    onDragOver: event => { event.preventDefault(); setDragging(true) },
    onDragLeave: event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false) },
    onDrop: event => {
      event.preventDefault()
      setDragging(false)
      const file = event.dataTransfer?.files?.[0]
      if (!file) return
      if (String(file.type).startsWith('image/')) insertImageFile(file)
      else onImportDocument(file)
    },
  },
    h('div', { className: 'ws-left-head' },
      h('div', { className: 'ws-doc-switch' },
        h('button', { type: 'button', className: 'ws-doc-current', onClick: () => setDocMenu(value => !value) },
          h(Icon, { name: 'doc', size: 14 }),
          h('span', null, doc.meta.title.trim() || parsed.title || t('未命名草稿')),
          h(Icon, { name: 'chevron', size: 12 }),
        ),
        docMenu
          ? h('div', { className: 'ws-doc-menu', onMouseLeave: () => setDocMenu(false) },
            store.docs.map(entry => h('button', {
              key: entry.id,
              type: 'button',
              className: entry.id === doc.id ? 'on' : '',
              onClick: () => { store.selectDoc(entry.id); setDocMenu(false); setSelectedBlock(null) },
            },
            h('span', { className: 'ws-doc-name' }, entry.meta.title.trim() || parseArticle(entry.text).title || t('未命名草稿')),
            h('span', { className: 'ws-doc-date' }, formatDate(entry.updatedAt)),
            )),
          )
          : null,
      ),
      h('div', { className: 'ws-left-actions' },
        h(IconButton, { icon: 'search', title: t('查找与替换'), onClick: () => setSearchOpen(value => !value) }),
        h(IconButton, { icon: 'chat', title: t('AI 对话修改'), onClick: onOpenAi }),
        h(IconButton, { icon: 'upload', title: t('上传文档（.md / .txt / .docx / .html）'), onClick: () => uploadRef.current?.click() }),
        h(IconButton, { icon: 'plus', title: t('新建草稿'), onClick: () => { store.addDoc(''); setSelectedBlock(null); toast(t('已新建草稿')) } }),
        h(IconButton, { icon: 'trash', title: t('删除当前草稿'), onClick: () => { store.removeDoc(doc.id); setSelectedBlock(null); toast(t('草稿已删除')) } }),
        h('input', {
          ref: uploadRef,
          type: 'file',
          accept: '.md,.markdown,.txt,.docx,.html,.htm',
          style: { display: 'none' },
          onChange: event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onImportDocument(file)
          },
        }),
        h('input', {
          ref: imageRef,
          type: 'file',
          accept: 'image/*',
          style: { display: 'none' },
          onChange: event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) insertImageFile(file)
          },
        }),
      ),
    ),
    parsed.title !== '' && doc.meta.title.trim() !== '' && doc.meta.title.trim() !== parsed.title
      ? h('div', { className: 'ws-title-hint' }, `正文 H1 是「${parsed.title}」，发布与预览当前用上面这个标题；留空则回到 H1。`)
      : null,
    doc.meta.sample === true
      ? h('div', { className: 'ws-title-hint' }, t('这是示例文案。粘贴你的内容、上传文档或直接编辑，就会替换掉它。'))
      : null,
    h('input', {
      className: 'ws-title-input',
      placeholder: parsed.title !== '' ? parsed.title : t('文章标题（也可以直接写 # 标题）'),
      value: doc.meta.title,
      onChange: event => store.updateMeta({ title: event.target.value }),
    }),
    searchOpen
      ? h('div', { className: 'ws-searchbar' },
        h('input', { className: 'ws-input', value: findText, placeholder: t('查找'), onChange: event => setFindText(event.target.value), onKeyDown: event => { if (event.key === 'Enter') { event.preventDefault(); findNext() } } }),
        h('input', { className: 'ws-input', value: replaceText, placeholder: t('替换为'), onChange: event => setReplaceText(event.target.value) }),
        h('button', { type: 'button', className: 'ws-link', onClick: findNext }, t('下一个')),
        h('button', { type: 'button', className: 'ws-link', onClick: replaceOne }, t('替换')),
        h('button', { type: 'button', className: 'ws-link', onClick: replaceAll }, t('全部替换')),
        h('button', { type: 'button', className: 'ws-link', onClick: () => setSearchOpen(false) }, t('关闭')),
      )
      : null,
    outline.length > 1
      ? h('div', { className: 'ws-outline' },
        h('span', { className: 'ws-outline-label' }, t('大纲')),
        h('div', { className: 'ws-outline-list' },
          outline.map(({ block, index }) => h('button', {
            key: index,
            type: 'button',
            className: 'ws-outline-item' + (selectedBlock === index ? ' on' : ''),
            'data-level': block.level ?? 2,
            title: block.text,
            onClick: () => onGoToBlock(index),
          }, block.type === 'title' ? t('标题') : block.text)),
        ),
      )
      : null,
    h('div', { className: 'ws-toolbar' },
      toolbar.map(item => {
        const active = item.format === 'h2' ? formats.heading === 2
          : item.format === 'h3' ? formats.heading === 3
            : item.format === 'quote' ? formats.quote
              : item.format === 'ul' ? formats.list === 'ul'
                : item.format === 'ol' ? formats.list === 'ol'
                  : item.format === 'bold' ? formats.bold
                    : item.format === 'hl' ? formats.highlight
                      : false
        return h('button', {
          key: item.label,
          type: 'button',
          className: 'ws-tool' + (active ? ' on' : ''),
          title: item.title,
          onClick: item.run,
        }, item.label)
      }),
    ),
    h('textarea', {
      ref: textareaRef,
      className: 'ws-editor',
      value: doc.text,
      spellCheck: false,
      placeholder: t('把公众号文案粘到这里。支持 Markdown：## 小节、> 引用、- 列表、![图片](url)、--- 分割线、**加粗**、==高亮==。'),
      onSelect: handleEditorSelect,
      onClick: handleEditorSelect,
      onChange: event => store.updateDoc(current => ({
        ...current,
        text: event.target.value,
        meta: current.meta.sample === true ? { ...current.meta, sample: false } : current.meta,
      }), { coalesce: 'text' }),
      onPaste: event => {
        const imageFile = Array.from(event.clipboardData?.files ?? []).find(file => String(file.type).startsWith('image/'))
        if (imageFile) {
          event.preventDefault()
          insertImageFile(imageFile)
          return
        }
        const pasted = event.clipboardData?.getData('text') ?? ''
        const pastedHtml = event.clipboardData?.getData('text/html') ?? ''
        const clipboard = markdownFromClipboard(pastedHtml, pasted)
        if (clipboard.converted) {
          event.preventDefault()
          materializeInlineImages(clipboard.markdown, { kind: 'paste' }).then(text => {
            insertText(text)
            if (typeof onImagesChanged === 'function') onImagesChanged()
            toast(t('已把富文本转换为 Markdown'), 'success')
            if (text.trim().length >= 240) onContentPasted()
          }).catch(error => toast(error.message || t('富文本转换失败'), 'error'))
          return
        }
        if (pasted.includes('data:image/')) {
          event.preventDefault()
          materializeInlineImages(pasted, { kind: 'paste' }).then(text => {
            insertText(text)
            if (typeof onImagesChanged === 'function') onImagesChanged()
            if (text.trim().length >= 240) onContentPasted()
          }).catch(error => toast(error.message || t('图片处理失败'), 'error'))
          return
        }
        const element = event.currentTarget
        const replacingAll = element.selectionStart === 0 && element.selectionEnd === element.value.length
        const before = element.value.trim().length
        if (pasted.trim().length >= 240 && (before < 80 || replacingAll)) onContentPasted()
      },
      onKeyDown: event => {
        if (!(event.metaKey || event.ctrlKey)) return
        const key = event.key.toLowerCase()
        if (key === 'z' && !event.shiftKey) { event.preventDefault(); store.undo(); return }
        if ((key === 'z' && event.shiftKey) || key === 'y') { event.preventDefault(); store.redo(); return }
        if (event.code === 'KeyF' && !event.shiftKey) { event.preventDefault(); setSearchOpen(true); return }
        if (event.code === 'KeyB' && !event.shiftKey) { event.preventDefault(); insert('**', '**', t('加粗文字')); return }
        if (event.code === 'KeyH' && event.shiftKey) { event.preventDefault(); insert('==', '==', t('高亮文字')); return }
        if (event.code === 'KeyK') { event.preventDefault(); insert('[', '](https://)', t('链接文字')); return }
        if (event.code === 'Digit1' || event.code === 'Digit2' || event.code === 'Digit3') {
          if (event.shiftKey) return
          event.preventDefault()
          toggleHeading(Number(event.code.slice(-1)))
          return
        }
        if (event.shiftKey && event.code === 'Digit7') { event.preventDefault(); toggleList(false); return }
        if (event.shiftKey && event.code === 'Digit8') { event.preventDefault(); toggleList(true); return }
      },
    }),
    h('div', { className: 'ws-left-foot' },
      h('span', null, t('{chars} 字 · 约 {minutes} 分钟', { chars: features.chars, minutes: features.readingMinutes })),
      selectedBlock !== null ? h('span', { className: 'ws-foot-hint' }, t('已选中第 {index} 段', { index: selectedBlock + 1 })) : null,
      h('span', { className: 'ws-top-spacer' }),
      h('span', { className: 'ws-saved' }, h(Icon, { name: 'check', size: 12 }), t('本地自动保存')),
    ),
  )
}

/* ------------------------------------------------------------------ *
 * Middle: live phone preview with per-block controls
 * ------------------------------------------------------------------ */

/** Re-encode any large inline data-URL image so a Word import stays editable. */
async function shrinkMarkdownImages(text) {
  const pattern = /!\[([^\]]*)\]\((data:image\/[a-zA-Z+]+;base64,[^)]+)\)/g
  const matches = Array.from(String(text ?? '').matchAll(pattern))
  if (matches.length === 0) return text
  let output = String(text)
  for (const match of matches.slice(0, 12)) {
    const dataUrl = match[2]
    try {
      if (base64Bytes(dataUrl) <= 240 * 1024) continue
      const compressed = await compressImage(dataUrl, 1080)
      output = output.split(dataUrl).join(compressed.dataUrl)
    } catch {
      // Keep the original image when the canvas cannot decode it.
    }
  }
  return output
}

/** Live clock for the status bar; recomputed twice a minute. */
function useClockText() {
  const format = () => {
    const now = new Date()
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  }
  const [text, setText] = React.useState(format)
  React.useEffect(() => {
    const timer = window.setInterval(() => setText(format()), 30000)
    return () => window.clearInterval(timer)
  }, [])
  return text
}

/** Status-bar glyphs: cellular bars, Wi-Fi, battery. */
function PhoneStatusGlyphs() {
  return h('div', { className: 'ws-status-glyphs' },
    h('svg', { width: 17, height: 12, viewBox: '0 0 17 12', fill: 'currentColor', 'aria-hidden': 'true' },
      h('rect', { x: 0, y: 8, width: 3, height: 4, rx: 1 }),
      h('rect', { x: 4.5, y: 6, width: 3, height: 6, rx: 1 }),
      h('rect', { x: 9, y: 3.5, width: 3, height: 8.5, rx: 1 }),
      h('rect', { x: 13.5, y: 1, width: 3, height: 11, rx: 1 }),
    ),
    h('svg', { width: 16, height: 12, viewBox: '0 0 16 12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': 'true' },
      h('path', { d: 'M1.5 4.2C5.5 0.8 10.5 0.8 14.5 4.2' }),
      h('path', { d: 'M4.2 7C6.5 5 9.5 5 11.8 7' }),
      h('circle', { cx: 8, cy: 10, r: 1.1, fill: 'currentColor', stroke: 'none' }),
    ),
    h('svg', { width: 25, height: 12, viewBox: '0 0 25 12', fill: 'none', 'aria-hidden': 'true' },
      h('rect', { x: 0.7, y: 1.2, width: 21, height: 9.6, rx: 2.6, stroke: 'currentColor', strokeOpacity: 0.45, strokeWidth: 1.1 }),
      h('rect', { x: 2.2, y: 2.7, width: 15, height: 6.6, rx: 1.4, fill: 'currentColor' }),
      h('path', { d: 'M23.4 4.2v3.6c.9-.3 1.4-1 1.4-1.8s-.5-1.5-1.4-1.8z', fill: 'currentColor', fillOpacity: 0.5 }),
    ),
  )
}

/** One glyph for the WeChat bottom action bar. */
function WechatActionGlyph({ kind }) {
  const common = { width: 21, height: 21, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }
  if (kind === 'share') {
    return h('svg', common, h('path', { d: 'M12 3v13' }), h('path', { d: 'M7.5 7.5L12 3l4.5 4.5' }), h('path', { d: 'M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6' }))
  }
  if (kind === 'wow') {
    return h('svg', common,
      h('path', { d: 'M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z' }),
      h('circle', { cx: 12, cy: 12, r: 2.4 }),
    )
  }
  return h('svg', common,
    h('path', { d: 'M7 10.5v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3z' }),
    h('path', { d: 'M7 10.5l3.4-7a1.8 1.8 0 0 1 3.3 1.4L12.6 9h5.2a1.8 1.8 0 0 1 1.8 2.2l-1.3 6.1A1.8 1.8 0 0 1 16.5 19H7' }),
  )
}

/** The native-looking WeChat article chrome around the rendered body. */
function WechatPhoneChrome(props) {
  const { children, brand, source, empty, device = 'iphone' } = props
  const android = device === 'android'
  const clock = useClockText()
  return h('div', { className: 'ws-phone' + (android ? ' ws-phone-android' : '') },
    android ? null : h('span', { className: 'ws-side-btn ws-side-btn-mute' }),
    android ? null : h('span', { className: 'ws-side-btn ws-side-btn-volup' }),
    android ? null : h('span', { className: 'ws-side-btn ws-side-btn-voldown' }),
    android ? null : h('span', { className: 'ws-side-btn ws-side-btn-power' }),
    h('div', { className: 'ws-screen' },
      h('div', { className: 'ws-statusbar' },
        h('span', { className: 'ws-status-time' }, clock),
        h(PhoneStatusGlyphs, null),
      ),
      android
        ? h('div', { className: 'ws-punch', 'aria-hidden': 'true' })
        : h('div', { className: 'ws-island', 'aria-hidden': 'true' }),
      h('div', { className: 'ws-wechat-nav' },
        h('span', { className: 'ws-nav-back' }, h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('path', { d: 'M15 4.5L7.5 12 15 19.5' }))),
        h('span', { className: 'ws-nav-brand' }, brand),
        h('span', { className: 'ws-nav-more' }, h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true' }, h('circle', { cx: 5, cy: 12, r: 1.7 }), h('circle', { cx: 12, cy: 12, r: 1.7 }), h('circle', { cx: 19, cy: 12, r: 1.7 }))),
      ),
      h('div', { className: 'ws-phone-scroll' },
        empty ? h('div', { className: 'ws-empty' }, t('把文案粘到左侧，或上传 .md / .docx 文档，这里会实时出现公众号版式。也可以点下方「插入图片」放一张插图。')) : children,
        !empty && source !== ''
          ? h('div', { className: 'ws-read-original' }, t('阅读原文'), h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('path', { d: 'M9 5l7 7-7 7' })))
          : null,
      ),
      h('div', { className: 'ws-wechat-actions' },
        h('span', { className: 'ws-comment-pill' }, t('写留言')),
        h('span', { className: 'ws-action-icon', title: t('分享') }, h(WechatActionGlyph, { kind: 'share' })),
        h('span', { className: 'ws-action-icon', title: t('在看') }, h(WechatActionGlyph, { kind: 'wow' })),
        h('span', { className: 'ws-action-icon', title: t('赞') }, h(WechatActionGlyph, { kind: 'like' })),
      ),
      h('div', { className: 'ws-home-indicator' }, h('i')),
    ),
  )
}

function PreviewStage(props) {
  const { article, design, doc, parsed, features, selectedBlock, setSelectedBlock, store, toast, narrow, date, onImagesChanged, device, setDevice } = props
  const previewImageRef = React.useRef(null)
  const pendingReplaceRef = React.useRef(null)
  React.useEffect(() => {
    if (selectedBlock === null) return
    const element = document.querySelector(`.ws-article [data-block="${selectedBlock}"]`)
    if (element !== null && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [selectedBlock])
  const [dragIndex, setDragIndex] = React.useState(null)
  const [cropBlock, setCropBlock] = React.useState(null)
  const [cropBusy, setCropBusy] = React.useState(false)
  const [captionBlock, setCaptionBlock] = React.useState(null)
  const [captionDraft, setCaptionDraft] = React.useState('')
  const startCaption = (blockIndex) => {
    const block = sourceBlocks[blockIndex]
    if (!block || block.type !== 'image') return
    setCaptionBlock(blockIndex)
    setCaptionDraft(block.alt ?? '')
  }
  const saveCaption = (blockIndex, value) => {
    const block = sourceBlocks[blockIndex]
    if (!block || block.type !== 'image') return
    const next = replaceImageCaption(doc.text, block.lines[0], value)
    store.updateDoc(current => ({ ...current, text: next }))
    setCaptionBlock(null)
    setCaptionDraft('')
    toast(t('图注已更新'))
  }
  const cancelCaption = () => { setCaptionBlock(null); setCaptionDraft('') }
  const cropImage = async (blockIndex, ratio) => {
    const block = sourceBlocks[blockIndex]
    if (!block || block.type !== 'image') return
    setCropBusy(true)
    try {
      const source = expandImageRefs(block.src)
      if (!source.startsWith('data:')) throw new Error(t('远程图片暂时只能换图，不能直接裁剪'))
      const image = await loadImage(source)
      const targetRatio = Number(ratio)
      let sourceWidth = image.width
      let sourceHeight = image.height
      if (sourceWidth / sourceHeight > targetRatio) sourceWidth = Math.round(sourceHeight * targetRatio)
      else sourceHeight = Math.round(sourceWidth / targetRatio)
      const sourceX = Math.round((image.width - sourceWidth) / 2)
      const sourceY = Math.round((image.height - sourceHeight) / 2)
      const canvas = document.createElement('canvas')
      canvas.width = Math.min(1200, sourceWidth)
      canvas.height = Math.round(canvas.width / targetRatio)
      const context = canvas.getContext('2d')
      if (context === null) throw new Error(t('当前环境无法处理图片'))
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
      const compressed = await compressImage(canvas.toDataURL('image/jpeg', 0.9), 1200)
      const ref = await materializeImage(compressed.dataUrl, { kind: 'content' })
      store.updateDoc(current => ({ ...current, text: replaceImageSource(current.text, block.lines[0], ref) }))
      if (typeof onImagesChanged === 'function') onImagesChanged()
      setCropBlock(null)
      toast(t('图片已裁剪'))
    } catch (error) {
      toast(error.message || t('图片处理失败'), 'error')
    } finally {
      setCropBusy(false)
    }
  }

  const replaceImage = (blockIndex) => {
    pendingReplaceRef.current = blockIndex
    previewImageRef.current?.click()
  }
  const replaceImageFile = async (blockIndex, file) => {
    const block = sourceBlocks[blockIndex]
    if (!block || block.type !== 'image') return
    try {
      const raw = await readFileAsDataUrl(file)
      const compressed = await compressImage(raw, 1200)
      const alt = String(file.name ?? t('配图')).replace(/\.[^.]+$/, '') || t('配图')
      const ref = await materializeImage(compressed.dataUrl, { kind: 'content' })
      const lines = doc.text.split('\n')
      const next = [
        ...lines.slice(0, block.lines[0]),
        `![${alt}](${ref})`,
        ...lines.slice(block.lines[1] + 1),
      ].join('\n')
      store.updateDoc(current => ({ ...current, text: next }))
      if (typeof onImagesChanged === 'function') onImagesChanged()
      toast('图片已替换')
    } catch (error) {
      toast(error.message || t('图片处理失败'), 'error')
    }
  }
  const insertPreviewImage = async (file) => {
    if (!file) return
    try {
      const raw = await readFileAsDataUrl(file)
      const compressed = await compressImage(raw, 1200)
      const alt = String(file.name ?? t('配图')).replace(/\.[^.]+$/, '') || t('配图')
      const ref = await materializeImage(compressed.dataUrl, { kind: 'content' })
      store.updateDoc(current => ({
        ...current,
        text: `${current.text.trimEnd()}${current.text.trim() === '' ? '' : '\n\n'}![${alt}](${ref})`,
      }))
      if (typeof onImagesChanged === 'function') onImagesChanged()
      toast('插图已加到正文末尾')
    } catch (error) {
      toast(error.message || t('图片处理失败'), 'error')
    }
  }
  const root = article.nodes[0]
  const titleFirst = article.title !== ''
  const sourceBlocks = parsed.blocks.filter(block => block.type !== 'title')

  const moveBlock = (index, direction) => {
    const blocks = parsed.blocks
    const groups = sourceBlocks.map(block => ({ start: block.lines[0], end: block.lines[1] }))
    const target = index + direction
    if (target < 0 || target >= groups.length) return
    const lines = doc.text.split('\n')
    const a = groups[index]
    const b = groups[target]
    const first = a.start < b.start ? a : b
    const second = a.start < b.start ? b : a
    const firstLines = lines.slice(first.start, first.end + 1)
    const secondLines = lines.slice(second.start, second.end + 1)
    const next = [
      ...lines.slice(0, first.start),
      ...(a.start < b.start ? secondLines : firstLines),
      ...lines.slice(first.end + 1, second.start),
      ...(a.start < b.start ? firstLines : secondLines),
      ...lines.slice(second.end + 1),
    ].join('\n')
    void blocks
    store.updateDoc(current => ({ ...current, text: next }))
    setSelectedBlock(target)
    setCaptionBlock(null)
  }

  const moveBlockTo = (from, to) => {
    if (from === to || from < 0 || to < 0) return
    const groups = sourceBlocks.map(block => ({ start: block.lines[0], end: block.lines[1] }))
    const lines = doc.text.split('\n')
    const source = groups[from]
    const target = groups[to]
    if (!source || !target) return
    const blockLines = lines.slice(source.start, source.end + 1)
    const remaining = [...lines.slice(0, source.start), ...lines.slice(source.end + 1)]
    const shift = to > from ? source.end - source.start + 1 : 0
    const insertAt = target.start - shift
    const next = [...remaining.slice(0, insertAt), ...blockLines, ...remaining.slice(insertAt)].join('\n')
    store.updateDoc(current => ({ ...current, text: next }))
    setSelectedBlock(to > from ? to : to)
    setDragIndex(null)
  }

  const duplicateBlock = (index) => {
    const block = sourceBlocks[index]
    if (!block) return
    const lines = doc.text.split('\n')
    const copy = lines.slice(block.lines[0], block.lines[1] + 1)
    const next = [...lines.slice(0, block.lines[1] + 1), ...copy, ...lines.slice(block.lines[1] + 1)].join('\n')
    store.updateDoc(current => ({ ...current, text: next }))
    setSelectedBlock(index + 1)
    toast(t('已复制这一段'))
  }

  const removeBlock = (index) => {
    const groups = sourceBlocks.map(block => ({ start: block.lines[0], end: block.lines[1] }))
    const lines = doc.text.split('\n')
    const group = groups[index]
    if (!group) return
    let start = group.start
    let end = group.end
    if ((lines[end + 1] ?? '').trim() === '') end += 1
    else if ((lines[start - 1] ?? '').trim() === '') start -= 1
    const next = [...lines.slice(0, start), ...lines.slice(end + 1)].join('\n')
    store.updateDoc(current => ({ ...current, text: next }))
    setSelectedBlock(null)
    setCaptionBlock(null)
    toast('已删除这一段')
  }

  const blockLabel = (block) => {
    if (!block) return ''
    if (block.type === 'heading') return t('小节')
    if (block.type === 'quote') return t('引用')
    if (block.type === 'list') return t('列表')
    if (block.type === 'image') return t('图片')
    if (block.type === 'code') return t('代码')
    if (block.type === 'divider') return t('分割线')
    return t('段落')
  }

  const brand = (doc.meta.brand ?? '').trim() || t('公众号')
  const source = (doc.meta.sourceUrl ?? '').trim()

  return h('section', { className: 'ws-mid' },
    h('div', { className: 'ws-stage' },
      h(WechatPhoneChrome, { brand, source, empty: doc.text.trim() === '', device },
        h(ArticleBody, {
          root, titleFirst, sourceBlocks, selectedBlock, setSelectedBlock, moveBlock, removeBlock, blockLabel,
          captionBlock, captionDraft, setCaptionDraft, startCaption, saveCaption, cancelCaption,
          dragIndex, setDragIndex, moveBlockTo, duplicateBlock, cropBlock, setCropBlock, cropBusy, cropImage,
        }),
      ),
      h('input', {
        ref: previewImageRef,
        type: 'file',
        accept: 'image/*',
        style: { display: 'none' },
        onChange: event => {
          const file = event.target.files?.[0]
          const replaceIndex = pendingReplaceRef.current
          pendingReplaceRef.current = null
          event.target.value = ''
          if (!file) return
          if (replaceIndex !== null) replaceImageFile(replaceIndex, file)
          else insertPreviewImage(file)
        },
      }),
      h('div', { className: 'ws-stage-bar' },
        h('button', { type: 'button', className: 'ws-mini-btn', onClick: () => previewImageRef.current?.click() }, t('插入图片')),
        h('div', { className: 'ws-device-switch' },
          h('button', { type: 'button', className: 'ws-device-btn' + (device !== 'android' ? ' on' : ''), onClick: () => setDevice('iphone') }, 'iPhone'),
          h('button', { type: 'button', className: 'ws-device-btn' + (device === 'android' ? ' on' : ''), onClick: () => setDevice('android') }, 'Android'),
        ),
        h('span', { className: 'ws-stage-chip' }, h('i', { style: { background: design.colors.accent } }), design.colors.accent),
        h('span', { className: 'ws-stage-chip' }, `正文 ${design.type.bodySize}px / 行高 ${design.type.lineHeight}`),
        h('span', { className: 'ws-stage-chip' }, `边距 ${design.layout.paddingX}px`),
        h('span', { className: 'ws-stage-note' }, t('悬停段落可上移、下移或删除')),
      ),
    ),
  )
}

function ArticleBody(props) {
  const { root, titleFirst, sourceBlocks, selectedBlock, setSelectedBlock, moveBlock, removeBlock, blockLabel, replaceImage, captionBlock, captionDraft, setCaptionDraft, startCaption, saveCaption, cancelCaption, dragIndex, setDragIndex, moveBlockTo, duplicateBlock, cropBlock, setCropBlock, cropBusy, cropImage } = props
  const [hovered, setHovered] = React.useState(null)
  const children = root.children

  return h('div', {
    className: 'ws-article',
    style: root.style,
  }, children.map((child, index) => {
    const blockIndex = index - (titleFirst ? 1 : 0)
    const block = blockIndex >= 0 && blockIndex < sourceBlocks.length ? sourceBlocks[blockIndex] : null
    const content = nodesToReact([child], h)
    if (!block) return h('div', { key: index, className: 'ws-block' }, content)
    const isSelected = selectedBlock === blockIndex
    return h('div', {
      key: index,
      className: 'ws-block' + (isSelected ? ' selected' : '') + (hovered === blockIndex ? ' hovered' : '') + (dragIndex === blockIndex ? ' dragging' : ''),
      'data-block': blockIndex,
      draggable: true,
      onDragStart: () => setDragIndex(blockIndex),
      onDragEnd: () => setDragIndex(null),
      onDragOver: event => event.preventDefault(),
      onDrop: event => { event.preventDefault(); moveBlockTo(dragIndex, blockIndex) },
      onMouseEnter: () => setHovered(blockIndex),
      onMouseLeave: () => setHovered(value => (value === blockIndex ? null : value)),
      onClick: () => setSelectedBlock(isSelected ? null : blockIndex),
    },
    isSelected ? h('div', { className: 'ws-block-tag' }, blockLabel(block)) : null,
    content,
    cropBlock === blockIndex && block.type === 'image'
      ? h('div', { className: 'ws-caption-editor', onClick: event => event.stopPropagation() },
        h('span', { className: 'ws-hint' }, t('裁剪比例')),
        [['1', '1:1'], ['1.3333', '4:3'], ['1.7778', '16:9']].map(([ratio, label]) => h('button', {
          key: ratio,
          type: 'button',
          className: 'ws-link',
          disabled: cropBusy,
          onClick: () => cropImage(blockIndex, ratio),
        }, label)),
        h('button', { type: 'button', className: 'ws-link', onClick: () => setCropBlock(null) }, t('取消')),
      )
      : null,
    captionBlock === blockIndex && block.type === 'image'
      ? h('div', { className: 'ws-caption-editor', onClick: event => event.stopPropagation() },
        h('input', {
          className: 'ws-input',
          value: captionDraft,
          placeholder: t('图片说明，留空则不显示'),
          autoFocus: true,
          onChange: event => setCaptionDraft(event.target.value),
          onKeyDown: event => {
            if (event.key === 'Enter') { event.preventDefault(); saveCaption(blockIndex, captionDraft) }
            if (event.key === 'Escape') { event.preventDefault(); cancelCaption() }
          },
        }),
        h('button', { type: 'button', className: 'ws-link', onClick: () => saveCaption(blockIndex, captionDraft) }, t('保存')),
        h('button', { type: 'button', className: 'ws-link', onClick: () => saveCaption(blockIndex, '') }, t('清除')),
        h('button', { type: 'button', className: 'ws-link', onClick: cancelCaption }, t('取消')),
      )
      : null,
    h('div', { className: 'ws-block-tools' },
      block.type === 'image' ? h('button', { type: 'button', title: t('裁剪图片'), onClick: event => { event.stopPropagation(); setCropBlock(blockIndex) } }, h(Icon, { name: 'image', size: 12 })) : null,
      block.type === 'image' ? h('button', { type: 'button', title: t('编辑图注'), onClick: event => { event.stopPropagation(); startCaption(blockIndex) } }, h(Icon, { name: 'pen', size: 12 })) : null,
      block.type === 'image' ? h('button', { type: 'button', title: t('替换图片'), onClick: event => { event.stopPropagation(); replaceImage(blockIndex) } }, h(Icon, { name: 'image', size: 12 })) : null,
      h('button', { type: 'button', title: t('复制这一段'), onClick: event => { event.stopPropagation(); duplicateBlock(blockIndex) } }, h(Icon, { name: 'copy', size: 12 })),
      h('button', { type: 'button', title: t('上移'), onClick: event => { event.stopPropagation(); moveBlock(blockIndex, -1) } }, h(Icon, { name: 'arrowUp', size: 12 })),
      h('button', { type: 'button', title: t('下移'), onClick: event => { event.stopPropagation(); moveBlock(blockIndex, 1) } }, h(Icon, { name: 'arrowDown', size: 12 })),
      h('button', { type: 'button', title: t('删除这一段'), onClick: event => { event.stopPropagation(); removeBlock(blockIndex) } }, h(Icon, { name: 'trash', size: 12 })),
    ),
    )
  }))
}

/* ------------------------------------------------------------------ *
 * Right panel
 * ------------------------------------------------------------------ */

const TABS = [
  { id: 'ai', label: t('AI') },
  { id: 'theme', label: t('主题') },
  { id: 'type', label: t('排版') },
  { id: 'decor', label: t('装饰') },
  { id: 'publish', label: t('发布') },
]

