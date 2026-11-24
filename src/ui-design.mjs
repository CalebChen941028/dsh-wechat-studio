function DesignPanel(props) {
  const { store, design, doc, analysis, features, hostStatus, setHostStatus, tab, setTab, toast, parsed, article, selectedBlock, showClose, onClose, autoRefine, setAutoRefine, refining, onRefineNow, takeSnapshot, snapshotVersion } = props
  return h('aside', { className: 'ws-right' },
    h('div', { className: 'ws-tabs' },
      TABS.map(entry => h('button', {
        key: entry.id,
        type: 'button',
        className: 'ws-tab' + (tab === entry.id ? ' on' : ''),
        onClick: () => setTab(entry.id),
      }, entry.label)),
      showClose ? h('button', { type: 'button', className: 'ws-tab-close', title: t('收起设计面板'), onClick: onClose }, h(Icon, { name: 'close', size: 14 })) : null,
    ),
    h('div', { className: 'ws-panel' },
      h('div', { className: 'ws-pane' + (tab === 'ai' ? '' : ' ws-pane-hidden') },
        h(AiSection, { store, design, doc, parsed, hostStatus, toast, selectedBlock, takeSnapshot })),
      h('div', { className: 'ws-pane' + (tab === 'theme' ? '' : ' ws-pane-hidden') },
        h(ThemeSection, { store, design, analysis, doc, toast, autoRefine, setAutoRefine, refining, onRefineNow })),
      h('div', { className: 'ws-pane' + (tab === 'type' ? '' : ' ws-pane-hidden') },
        h(TypeSection, { store, design, doc, parsed, toast })),
      h('div', { className: 'ws-pane' + (tab === 'decor' ? '' : ' ws-pane-hidden') },
        h(DecorSection, { store, design, toast })),
      h('div', { className: 'ws-pane' + (tab === 'publish' ? '' : ' ws-pane-hidden') },
        h(PublishSection, {
          store, design, doc, parsed, article, features, hostStatus, setHostStatus, toast, takeSnapshot, snapshotVersion,
        })),
    ),
  )
}

function AiSection(props) {
  const { store, design, doc, parsed, hostStatus, toast, selectedBlock, takeSnapshot } = props
  const [messages, setMessages] = React.useState([])
  const [input, setInput] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [phase, setPhase] = React.useState('')
  const [chunked, setChunked] = React.useState(false)
  const [pending, setPending] = React.useState(null)
  const [scopeMode, setScopeMode] = React.useState('selection')
  const [stylePreset, setStylePreset] = React.useState('')
  const [memoryEvents, setMemoryEvents] = React.useState([])
  const abortRef = React.useRef(null)
  const refreshMemory = React.useCallback(() => {
    listStyleEvents(30).then(items => setMemoryEvents(items)).catch(() => setMemoryEvents([]))
  }, [])
  React.useEffect(() => { refreshMemory() }, [refreshMemory])
  const listRef = React.useRef(null)
  const inputRef = React.useRef(null)

  React.useEffect(() => {
    const element = listRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages, busy])

  const sourceBlocks = parsed.blocks.filter(block => block.type !== 'title')
  const selectedEntry = selectedBlock !== null ? sourceBlocks[selectedBlock] : undefined
  const canScope = selectedEntry !== undefined && ['paragraph', 'heading', 'quote', 'list'].includes(selectedEntry.type)
  React.useEffect(() => {
    if (canScope) setScopeMode('selection')
  }, [selectedBlock, canScope])
  const sectionRange = (() => {
    if (!canScope) return [0, -1]
    let start = selectedBlock
    if (sourceBlocks[selectedBlock].type !== 'heading') {
      while (start > 0 && sourceBlocks[start].type !== 'heading') start -= 1
    }
    let end = start + 1
    while (end < sourceBlocks.length && sourceBlocks[end].type !== 'heading') end += 1
    return [start, end - 1]
  })()
  const effectiveScope = !canScope || scopeMode === 'document'
    ? null
    : scopeMode === 'section' ? sectionRange : [selectedBlock, selectedBlock]
  const scopeLines = effectiveScope === null ? null : doc.text.split('\n').slice(
    sourceBlocks[effectiveScope[0]].lines[0],
    sourceBlocks[effectiveScope[1]].lines[1] + 1,
  )
  const scopeText = scopeLines === null ? '' : scopeLines.join('\n')
  const lockedHashes = Array.isArray(doc.meta.lockedHashes) ? doc.meta.lockedHashes : []
  const isLockedBlock = (block) => lockedHashes.includes(hashBlock(block.text))
  const scopeLocked = effectiveScope !== null && sourceBlocks.slice(effectiveScope[0], effectiveScope[1] + 1).some(isLockedBlock)
  const documentLocked = sourceBlocks.some(isLockedBlock)
  const styleInstruction = stylePreset === 'concise' ? '语气更克制，删掉套话与重复。'
    : stylePreset === 'spoken' ? '语气更口语，像在跟朋友说话。'
      : stylePreset === 'shorter' ? '尽量压缩篇幅，保留信息，不删事实。' : ''

  const send = async (override) => {
    const instruction = String(override ?? input).trim()
    if (instruction === '' || busy) return
    if (pending !== null) { toast(t('先应用或放弃当前建议')); return }
    if (doc.text.trim() === '') {
      toast('编辑区还是空的，先写点内容', 'error')
      return
    }
    if (scopeLocked) { toast(t('改写范围里有锁定段落，先在预览里解锁')); return }
    if (effectiveScope === null && documentLocked) { toast(t('全文里有锁定段落，先解锁或只改选中段/本节')); return }
    setInput('')
    const sentText = doc.text
    setMessages(list => [...list, { role: 'user', content: instruction }])
    setBusy(true)
    setProgress(0)
    setPhase('')
    try {
      let value
      const useChunks = scopeLines === null && chunked && doc.text.length > LONG_TEXT_CHUNK_THRESHOLD
      if (useChunks) {
        const chunks = splitMarkdownChunks(doc.text, 3200)
        if (chunks.length === 0) throw Object.assign(new Error(t('文章为空，无法分段')), { code: 'text-required' })
        if (chunks.length > 8) throw Object.assign(new Error(`文章会拆成 ${chunks.length} 段，超过 8 段上限；先手动拆成几篇再改`), { code: 'too-many-chunks' })
        const rewritten = []
        for (let index = 0; index < chunks.length; index += 1) {
          setPhase(t('第 {index}/{total} 段改写中', { index: index + 1, total: chunks.length }))
          const part = await callHost('aiEdit', {
            instruction: `${instruction}\n\n${styleInstruction}\n\n（这是全文第 ${index + 1}/${chunks.length} 段。只改写这一段，保持 Markdown 结构；不要输出 design；不要添加原文没有的事实。）`,
            text: chunks[index],
            title: doc.meta.title,
            design: doc.design,
            meta: { author: doc.meta.author, digest: doc.meta.digest },
            history: [],
            styleGuide: doc.meta.styleGuide ?? DEFAULT_STYLE_GUIDE,
            styleMemory: memoryEvents.filter(item => item.type === 'accepted').slice(0, 3).map(item => item.instruction),
          }, { timeoutMs: 150000 })
          if (typeof part.text !== 'string' || part.text.trim() === '') {
            throw Object.assign(new Error(`第 ${index + 1} 段没有返回改写结果，已取消，正文未改。`), { code: 'chunk-missing' })
          }
          rewritten.push(part.text.trim())
        }
        value = { reply: `分段改写完成（${chunks.length} 段），版式未改。`, text: rewritten.join('\n\n') }
      } else {
        setPhase(t('模型生成中'))
        const controller = typeof AbortController === 'function' ? new AbortController() : null
        abortRef.current = controller
        const effectiveInstruction = [
          instruction,
          styleInstruction,
          scopeLines === null ? '' : '（只改写下面这部分，不要改其他段落；保持 Markdown 结构；不要输出 design 和 meta。）',
        ].filter(Boolean).join('\n\n')
        value = await callHostStream('aiEditStream', {
          instruction: effectiveInstruction,
          text: scopeLines === null ? doc.text : scopeText,
          title: doc.meta.title,
          design: doc.design,
          meta: { author: doc.meta.author, digest: doc.meta.digest },
          history: messages.slice(-6).map(message => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content })),
          styleGuide: doc.meta.styleGuide ?? DEFAULT_STYLE_GUIDE,
          styleMemory: memoryEvents.filter(item => item.type === 'accepted').slice(0, 3).map(item => item.instruction),
        }, { timeoutMs: 150000, onProgress: chars => setProgress(chars), signal: controller?.signal })
      }

      const current = store.doc
      const typedMeanwhile = typeof value.text === 'string' && current.text !== sentText
      let nextText
      if (scopeLines !== null) {
        if (typeof value.text !== 'string' || value.text.trim() === '') {
          throw Object.assign(new Error(t('AI 没有返回选中段落的改写结果')), { code: 'selection-empty' })
        }
        if (!typedMeanwhile) {
          const currentLines = current.text.split('\n')
          nextText = [
            ...currentLines.slice(0, sourceBlocks[effectiveScope[0]].lines[0]),
            ...value.text.trim().split('\n'),
            ...currentLines.slice(sourceBlocks[effectiveScope[1]].lines[1] + 1),
          ].join('\n')
        }
      } else if (typeof value.text === 'string' && value.text.trim() !== '' && value.text !== current.text && !typedMeanwhile) {
        nextText = value.text
      }
      let nextDesign
      if (scopeLines === null && value.design && typeof value.design === 'object') {
        const theme = THEMES.find(entry => entry.id === value.design.themeId)
        const themeId = theme === undefined ? current.design.themeId : theme.id
        const variant = theme === undefined
          ? current.design.variantId
          : theme.variants.some(entry => entry.id === value.design.variantId) ? value.design.variantId : theme.variants[0].id
        const themeChanged = theme !== undefined && theme.id !== current.design.themeId
        nextDesign = {
          themeId,
          variantId: variant,
          overrides: themeChanged
            ? (value.design.overrides ?? {})
            : { ...(current.design.overrides ?? {}), ...(value.design.overrides ?? {}) },
        }
      }
      const nextMeta = scopeLines === null && value.meta && typeof value.meta === 'object' ? { ...current.meta, ...value.meta } : undefined

      const changes = []
      if (nextText !== undefined) changes.push(t('正文'))
      if (nextDesign !== undefined) changes.push(t('版式'))
      if (nextMeta !== undefined) changes.push(t('标题/摘要'))
      if (typedMeanwhile) changes.push(t('正文有改动，未覆盖'))

      if (nextText !== undefined || nextDesign !== undefined || nextMeta !== undefined) {
        setPending({
          baseText: sentText,
          instruction,
          text: nextText,
          design: nextDesign,
          meta: nextMeta,
          reply: scopeLines === null ? (value.reply || t('已修改')) : (value.reply ? `${scopeMode === 'section' ? t('已改写本节') : t('已改写选中段落')}。${value.reply}` : (scopeMode === 'section' ? t('已改写本节') : t('已改写选中段落'))),
          model: value.model?.model ?? '',
          parseError: value.parseError === true,
          changes,
          diff: nextText === undefined ? [] : diffTextLines(sentText, nextText),
        })
      } else {
        setMessages(list => [...list, {
          role: 'assistant',
          content: value.reply || t('已修改'),
          applied: changes,
          canUndo: false,
          model: value.model?.model ?? '',
          parseError: value.parseError === true,
        }])
      }
    } catch (error) {
      setMessages(list => [...list, { role: 'error', content: error.message || t('修改失败'), code: error.code }])
    } finally {
      setBusy(false)
      setPhase('')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  const applyPending = async () => {
    if (pending === null) return
    if (typeof takeSnapshot === 'function') await takeSnapshot('before-ai')
    const applied = []
    const patch = {}
    const current = store.doc
    const textSafe = pending.text !== undefined && current.text === pending.baseText
    if (pending.text !== undefined) {
      if (textSafe) { patch.text = pending.text; applied.push(t('正文')) }
      else applied.push(t('正文有改动，未覆盖'))
    }
    if (pending.design !== undefined) { patch.design = pending.design; applied.push(t('版式')) }
    if (pending.meta !== undefined) { patch.meta = { ...current.meta, ...pending.meta }; applied.push(t('标题/摘要')) }
    if (patch.text !== undefined) {
      const beforeBlocks = parseArticle(current.text).blocks
      const afterBlocks = parseArticle(patch.text).blocks
      const beforeHashes = new Set(beforeBlocks.map(block => hashBlock(block.text)))
      const afterHashes = new Set(afterBlocks.map(block => hashBlock(block.text)))
      const changed = afterBlocks.map(block => hashBlock(block.text)).filter(hash => !beforeHashes.has(hash))
      const known = Array.isArray(current.meta.aiHashes) ? current.meta.aiHashes : []
      patch.meta = {
        ...current.meta,
        ...(patch.meta ?? {}),
        aiHashes: [...new Set([...known, ...changed])].filter(hash => afterHashes.has(hash)),
      }
    }
    if (Object.keys(patch).length > 0) store.updateDoc(state => ({ ...state, ...patch }))
    appendStyleEvent({ docId: current.id, type: 'accepted', instruction: pending.instruction, stylePreset, scope: scopeMode }).then(refreshMemory).catch(() => {})
    setMessages(list => [...list, {
      role: 'assistant',
      content: pending.reply,
      applied,
      canUndo: Object.keys(patch).length > 0,
      model: pending.model,
      parseError: pending.parseError,
    }])
    if (Object.keys(patch).length > 0) toast(t('已应用 AI 修改：{parts}', { parts: applied.join('、') }), 'success')
    setPending(null)
  }

  const discardPending = () => {
    if (pending === null) return
    setMessages(list => [...list, { role: 'assistant', content: t('已放弃这次 AI 修改'), applied: [] }])
    appendStyleEvent({ docId: store.doc.id, type: 'discarded', instruction: pending.instruction, stylePreset, scope: scopeMode }).then(refreshMemory).catch(() => {})
    setPending(null)
  }

  const suggestions = [t('按内容重新精排'), t('标题更有冲击力'), t('第二段压缩到两行'), t('换成杂志版式'), t('加一个小节标题'), t('行距调到 1.9')]

  return h('div', { className: 'ws-chat' },
    h('div', { className: 'ws-card-head' },
      h(Icon, { name: 'chat', size: 14 }),
      h('span', null, t('AI 对话修改')),
      h('span', { className: 'ws-badge' }, busy ? t('修改中') : t('走当前默认模型')),
    ),
    messages.length === 0
      ? h('div', { className: 'ws-chat-empty' },
        h('p', null, t('直接说想怎么改，AI 会改正文、换主题或调版式，改完可以撤销。')),
        h('div', { className: 'ws-chips' },
          suggestions.map(text => h('button', {
            key: text,
            type: 'button',
            className: 'ws-chip',
            onClick: () => send(text),
          }, text)),
        ),
      )
      : h('div', { className: 'ws-chat-list', ref: listRef },
        messages.map((message, index) => h('div', { key: index, className: 'ws-msg ' + message.role },
          h('div', { className: 'ws-msg-body' }, message.content),
          message.role === 'error' && (message.code === 'model-failed' || message.code === 'ai-timeout' || message.code === 'response-truncated')
            ? h('div', { className: 'ws-msg-model' }, t('可以缩小改动范围再试一次；连续失败就去「设置 → 模型」检查当前默认模型。'))
            : null,
          message.applied && message.applied.length > 0
            ? h('div', { className: 'ws-msg-tags' },
              message.applied.map(tag => h('span', { key: tag, className: 'ws-msg-tag' }, tag)),
              h('button', {
                type: 'button',
                className: 'ws-link',
                onClick: () => { store.undo(); toast('已撤销这次修改') },
              }, t('撤销')),
            )
            : null,
          message.model ? h('div', { className: 'ws-msg-model' }, message.model) : null,
          message.parseError ? h('div', { className: 'ws-msg-model' }, t('模型没有按结构返回，只显示了说明')) : null,
        )),
        busy ? h('div', { className: 'ws-msg assistant typing' },
          h('span', { className: 'ws-typing-dot' }), h('span', { className: 'ws-typing-dot' }), h('span', { className: 'ws-typing-dot' }),
          h('span', { className: 'ws-msg-body' }, progress > 0 ? t('模型已生成 {chars} 字…', { chars: progress }) : (phase === '' ? t('正在按你的要求修改…') : phase)),
        ) : null,
      ),
    pending !== null
      ? h('div', { className: 'ws-diff-card' },
        h('div', { className: 'ws-diff-head' },
          h(Icon, { name: 'sparkles', size: 14 }),
          h('span', null, t('AI 建议修改')),
          h('span', { className: 'ws-badge' }, t('新增 {added} 行 · 删除 {removed} 行', {
            added: pending.diff.filter(item => item.type === 'add').length,
            removed: pending.diff.filter(item => item.type === 'remove').length,
          })),
        ),
        pending.diff.filter(item => item.type !== 'same').length > 0
          ? h('div', { className: 'ws-diff-lines' },
            pending.diff.filter(item => item.type !== 'same').slice(0, 14).map((item, index) => h('div', {
              key: index,
              className: 'ws-diff-line ' + item.type,
            }, `${item.type === 'add' ? '+' : '-'} ${item.text.length > 100 ? `${item.text.slice(0, 100)}…` : item.text || ' '}`)),
            pending.diff.filter(item => item.type !== 'same').length > 14
              ? h('div', { className: 'ws-diff-more' }, t('还有 {count} 行改动未显示', { count: pending.diff.filter(item => item.type !== 'same').length - 14 }))
              : null,
          )
          : h('p', { className: 'ws-hint' }, t('只调整版式与标题摘要，不改正文')),
        pending.design !== undefined
          ? h('p', { className: 'ws-hint' }, t('版式：{theme}', { theme: (() => {
            const theme = THEMES.find(entry => entry.id === pending.design.themeId)
            const variant = theme?.variants.find(entry => entry.id === pending.design.variantId)
            return `${theme?.name ?? pending.design.themeId}${variant === undefined ? '' : ` · ${variant.name}`}`
          })() }))
          : null,
        h('div', { className: 'ws-row' },
          h(Button, { variant: 'primary', onClick: applyPending }, t('应用修改')),
          h(Button, { variant: 'ghost', onClick: discardPending }, t('放弃')),
        ),
      )
      : null,
    canScope || stylePreset !== '' || doc.text.trim() !== ''
      ? h('div', { className: 'ws-chat-compose-option' },
        canScope
          ? h('div', { className: 'ws-scope-row' },
            h('span', { className: 'ws-hint' }, `${t('当前选中')}：${selectedEntry.text.slice(0, 20)}${selectedEntry.text.length > 20 ? '…' : ''}`),
            h('button', { type: 'button', className: 'ws-chip' + (scopeMode === 'selection' ? ' on' : ''), onClick: () => setScopeMode('selection') }, t('选中段')),
            h('button', { type: 'button', className: 'ws-chip' + (scopeMode === 'section' ? ' on' : ''), onClick: () => setScopeMode('section') }, t('本节')),
            h('button', { type: 'button', className: 'ws-chip' + (scopeMode === 'document' ? ' on' : ''), onClick: () => setScopeMode('document') }, t('整篇')),
          )
          : null,
        h('div', { className: 'ws-scope-row' },
          h('span', { className: 'ws-hint' }, t('语气')),
          [['', t('原样')], ['concise', t('更克制')], ['spoken', t('更口语')], ['shorter', t('更短')]].map(([id, label]) => h('button', {
            key: id || 'default',
            type: 'button',
            className: 'ws-chip' + (stylePreset === id ? ' on' : ''),
            onClick: () => setStylePreset(id),
          }, label)),
        ),
        scopeLocked || (effectiveScope === null && documentLocked)
          ? h('p', { className: 'ws-hint ws-error-text' }, scopeLocked ? t('范围里有锁定段落；先在预览里解锁') : t('全文有锁定段落；先解锁或只改选中段/本节'))
          : null,
        h('p', { className: 'ws-hint' }, t('预估约 {tokens} tokens（按字符粗算）', {
          tokens: Math.ceil(((scopeLines === null ? doc.text.length : scopeText.length) + input.length) / 2),
        })),
      )
      : null,
    doc.text.length > LONG_TEXT_CHUNK_THRESHOLD
      ? h('div', { className: 'ws-chat-compose-option' },
        h(Toggle, {
          label: `长文分段改写（约 ${splitMarkdownChunks(doc.text, 3200).length} 段，只改正文）`,
          checked: chunked,
          onChange: setChunked,
        }),
        chunked ? h('p', { className: 'ws-hint' }, t('会按小节拆成多段分别调用模型，耗时和费用更高；版式不会变。')) : null,
      )
      : null,
    h('div', { className: 'ws-chat-compose' },
      h('textarea', {
        ref: inputRef,
        className: 'ws-input ws-textarea',
        rows: 2,
        value: input,
        placeholder: t('说一句想怎么改，例如：把标题改短一点，第二段压到两行'),
        onChange: event => setInput(event.target.value),
        onKeyDown: event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing && event.keyCode !== 229) {
            event.preventDefault()
            send()
          }
        },
      }),
      h('div', { className: 'ws-row' },
        h(Button, { variant: 'primary', disabled: busy || pending !== null || input.trim() === '', onClick: () => send() }, busy ? t('修改中…') : t('发送')),
        busy ? h(Button, { variant: 'ghost', onClick: () => abortRef.current?.abort() }, t('取消')) : null,
        h('span', { className: 'ws-hint' }, t('Enter 发送，Shift+Enter 换行')),
      ),
    ),
    messages.length > 0
      ? h('div', { className: 'ws-chips' }, suggestions.slice(0, 4).map(text => h('button', {
        key: text,
        type: 'button',
        className: 'ws-chip',
        onClick: () => send(text),
      }, text)))
      : null,
    memoryEvents.length > 0
      ? h('div', { className: 'ws-memory' },
        h('div', { className: 'ws-memory-head' },
          h(Icon, { name: 'sparkles', size: 12 }),
          h('span', null, t('AI 风格记忆')),
          h('span', { className: 'ws-badge' }, `${t('采用 {count}', { count: memoryEvents.filter(item => item.type === 'accepted').length })} · ${t('放弃 {count}', { count: memoryEvents.filter(item => item.type === 'discarded').length })}`),
        ),
        h('p', { className: 'ws-hint' }, memoryEvents.filter(item => item.type === 'accepted').slice(0, 3).map(item => item.instruction).join(' / ') || t('还没有采用记录')),
        h('button', { type: 'button', className: 'ws-link', onClick: () => { clearStyleEvents().then(refreshMemory).catch(() => {}) } }, t('清空记忆')),
      )
      : null,
    h('p', { className: 'ws-hint' }, t('模型是当前会话的默认模型；要求改版式时只动主题与装饰，不会重写正文。')),
  )
}

function ThemeMiniPreview({ theme }) {
  const palette = theme.palette
  const type = theme.type
  return h('span', {
    className: 'ws-theme-mini',
    style: { background: palette.bg, color: palette.text, borderColor: palette.border },
    'aria-hidden': 'true',
  },
  h('span', {
    className: 'ws-theme-mini-title',
    style: {
      fontFamily: FONT_STACK[type.titleFont] ?? type.titleFont,
      fontWeight: type.titleWeight,
      fontSize: `${Math.min(15, Math.max(11, type.titleSize / 2.4))}px`,
      letterSpacing: type.titleTracking,
    },
  }, t('标题')),
  h('span', { className: 'ws-theme-mini-tag', style: { color: palette.accent, borderColor: palette.accentSoft } }, '01'),
  h('span', { className: 'ws-theme-mini-rule', style: { background: palette.accent } }),
  h('span', { className: 'ws-theme-mini-line', style: { background: palette.secondary } }),
  h('span', { className: 'ws-theme-mini-line short', style: { background: palette.secondary } }),
  h('span', { className: 'ws-theme-mini-quote', style: { borderLeftColor: palette.accent, color: palette.secondary, fontFamily: type.bodyFont } }, t('一句引文')),
  )
}

const THEME_FAVORITES_KEY = 'dsh.wechat-studio.themeFavorites.v1'
const THEME_RECENT_KEY = 'dsh.wechat-studio.themeRecent.v1'
const THEME_DNA_KEY = 'dsh.wechat-studio.themeDna.v1'

function loadThemeList(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : []
  } catch {
    return []
  }
}

function loadDnaPresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(THEME_DNA_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.id === 'string' && item.overrides) : []
  } catch {
    return []
  }
}

/** Extract a background/accent palette from a reference screenshot. */
function extractDnaPalette(dataUrl) {
  return loadImage(dataUrl).then(image => {
    const canvas = document.createElement('canvas')
    const size = 96
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) throw new Error(t('当前环境无法读取参考图'))
    context.drawImage(image, 0, 0, size, size)
    return paletteFromPixels(context.getImageData(0, 0, size, size).data)
  })
}

function ThemeSection(props) {
  const { store, design, analysis, doc, toast, autoRefine, setAutoRefine, refining, onRefineNow } = props
  const [filter, setFilter] = React.useState('all')
  const [favorites, setFavorites] = React.useState(() => loadThemeList(THEME_FAVORITES_KEY))
  const [recent, setRecent] = React.useState(() => loadThemeList(THEME_RECENT_KEY))
  const [dna, setDna] = React.useState(null)
  const [dnaCandidates, setDnaCandidates] = React.useState([])
  const [dnaName, setDnaName] = React.useState('')
  const [dnaPresets, setDnaPresets] = React.useState(() => loadDnaPresets())
  const [dnaBusy, setDnaBusy] = React.useState(false)
  const dnaInputRef = React.useRef(null)
  const brandInputRef = React.useRef(null)
  const saveDnaPreset = (candidate) => {
    const preset = {
      id: `dna-${Date.now().toString(36)}`,
      name: dnaName.trim() || `${t('参考图')} ${dnaPresets.length + 1}`,
      overrides: candidate.overrides,
    }
    setDnaPresets((list) => {
      const next = [preset, ...list].slice(0, 12)
      try { localStorage.setItem(THEME_DNA_KEY, JSON.stringify(next)) } catch { /* private mode */ }
      return next
    })
    setDnaName('')
    toast(t('已存为我的版式'), 'success')
  }
  const removeDnaPreset = (id) => {
    setDnaPresets((list) => {
      const next = list.filter(item => item.id !== id)
      try { localStorage.setItem(THEME_DNA_KEY, JSON.stringify(next)) } catch { /* private mode */ }
      return next
    })
  }
  const exportBrandKit = async () => {
    const snippets = await listSnippets().catch(() => [])
    const kit = createBrandKit({
      favorites,
      recent,
      dnaPresets,
      styleGuide: normalizeStyleGuide(doc.meta.styleGuide),
      snippets,
    })
    downloadFile('wechat-studio-brand-kit.json', JSON.stringify(kit, null, 2), 'application/json;charset=utf-8')
    toast(t('品牌包已导出'), 'success')
  }
  const importBrandKit = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const text = typeof file.text === 'function'
        ? await file.text()
        : await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result ?? ''))
          reader.onerror = () => reject(new Error(t('品牌包读取失败')))
          reader.readAsText(file)
        })
      const raw = JSON.parse(text)
      const incoming = parseBrandKit(raw)
      if (incoming === null) throw new Error(t('这不是公众号排版工作台的品牌包'))
      const current = createBrandKit({
        favorites,
        recent,
        dnaPresets,
        styleGuide: normalizeStyleGuide(doc.meta.styleGuide),
        snippets: await listSnippets().catch(() => []),
      })
      const merged = mergeBrandKits(current, incoming)
      setFavorites(merged.favorites)
      setRecent(merged.recent)
      setDnaPresets(merged.dnaPresets)
      try {
        localStorage.setItem(THEME_FAVORITES_KEY, JSON.stringify(merged.favorites))
        localStorage.setItem(THEME_RECENT_KEY, JSON.stringify(merged.recent))
        localStorage.setItem(THEME_DNA_KEY, JSON.stringify(merged.dnaPresets))
      } catch { /* private mode */ }
      if (merged.styleGuide !== null) store.updateMeta({ styleGuide: merged.styleGuide })
      for (const snippet of merged.snippets) await saveSnippet(snippet).catch(() => false)
      toast(t('已导入品牌包'), 'success')
    } catch (error) {
      toast(error.message || t('品牌包导入失败'), 'error')
    }
  }

  const applyDnaOverrides = (overrides) => {
    store.updateDesign(current => ({ ...current, overrides: { ...(current.overrides ?? {}), ...overrides } }))
  }
  const readDnaFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setDnaBusy(true)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const palette = await extractDnaPalette(dataUrl)
      const baseBackground = palette.background
      const accent = palette.accent === '' ? activeTheme.palette.accent : palette.accent
      const candidates = [
        { id: 'source', label: t('参考原色'), overrides: { accent, bg: baseBackground } },
        { id: 'deep', label: t('深色纸面'), overrides: { accent, bg: palette.dark ? baseBackground : mixHex(accent, '#111111', 0.72) } },
        { id: 'warm', label: t('低饱和'), overrides: { accent: mixHex(accent, baseBackground, 0.32), bg: baseBackground } },
      ]
      setDna({ ...palette, accent })
      setDnaCandidates(candidates)
      toast(t('已从参考图提取配色，挑一个配方试试'), 'success')
    } catch (failure) {
      toast(failure.message || t('参考图读取失败'), 'error')
    } finally {
      setDnaBusy(false)
    }
  }
  const activeTheme = THEMES.find(theme => theme.id === design.themeId) ?? THEMES[0]
  const toggleFavorite = (themeId) => {
    setFavorites((list) => {
      const next = list.includes(themeId) ? list.filter(id => id !== themeId) : [themeId, ...list]
      try { localStorage.setItem(THEME_FAVORITES_KEY, JSON.stringify(next)) } catch { /* private mode */ }
      return next
    })
  }
  const visibleThemes = filter === 'favorites'
    ? favorites.map(id => THEMES.find(theme => theme.id === id)).filter(Boolean)
    : filter === 'recent'
      ? recent.map(id => THEMES.find(theme => theme.id === id)).filter(Boolean)
      : THEMES
  const applyTheme = (theme) => {
    setRecent((list) => {
      const next = [theme.id, ...list.filter(id => id !== theme.id)].slice(0, 6)
      try { localStorage.setItem(THEME_RECENT_KEY, JSON.stringify(next)) } catch { /* private mode */ }
      return next
    })
    store.updateDoc(current => {
      const previous = current.design?.overrides ?? {}
      // Keep a deliberately chosen accent; theme decoration and type reset.
      const preservedAccent = typeof previous.accent === 'string' ? { accent: previous.accent } : {}
      return {
        ...current,
        design: {
          themeId: theme.id,
          variantId: theme.variants[0].id,
          overrides: {
            ...preservedAccent,
            eyebrow: previous.eyebrow ?? analysis.label,
            showEyebrow: ['eyebrow', 'tag', 'centered', 'kicker'].includes(theme.variants[0].titleStyle),
          },
        },
      }
    })
  }
  const setVariant = (variantId) => store.updateDesign(current => ({ ...current, variantId }))
  const setAccent = (accent) => store.updateDesign(current => ({
    ...current,
    overrides: { ...(current.overrides ?? {}), accent },
  }))

  return h('div', { className: 'ws-sections' },
    h('div', { className: 'ws-card ws-analyze' },
      h('div', { className: 'ws-card-head' },
        h(Icon, { name: 'sparkles', size: 14 }),
        h('span', null, t('内容分析')),
        h('span', { className: 'ws-badge' }, analysis.label),
      ),
      h('ul', { className: 'ws-reasons' },
        analysis.reasons.slice(0, 3).map((reason, index) => h('li', { key: index }, reason)),
        h('li', { key: 'current' }, `当前使用「${design.themeName}」·「${design.variantName}」`),
      ),
      h('p', { className: 'ws-hint' }, t('这份分析只看标题、结构、关键词与篇幅，不联网，也不改动你的正文。')),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('自动编排'))),
      h('p', { className: 'ws-hint' }, t('粘贴或上传文档后，先本地按内容套一版（不联网、立即出效果），随后可让 AI 再精排一次。')),
      h(Toggle, { label: t('粘贴 / 上传后让 AI 精排'), checked: autoRefine, onChange: setAutoRefine }),
      h(Button, { onClick: onRefineNow, disabled: refining }, refining ? t('AI 正在精排…') : t('现在就 AI 精排')),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('主题库')), h('span', { className: 'ws-group-note' }, `${THEMES.reduce((count, entry) => count + entry.variants.length, 0)} 个版式`)),
      h('div', { className: 'ws-chips ws-theme-filter' },
        [['all', t('全部')], ['favorites', t('收藏')], ['recent', t('最近')]].map(([id, label]) => h('button', {
          key: id,
          type: 'button',
          className: 'ws-chip' + (filter === id ? ' on' : ''),
          onClick: () => setFilter(id),
        }, label)),
      ),
      visibleThemes.length === 0
        ? h('p', { className: 'ws-hint' }, t('还没有收藏主题；点主题卡上的星标即可收藏。'))
        : h('div', { className: 'ws-themes' },
          visibleThemes.map(theme => h('div', {
            key: theme.id,
            role: 'button',
            tabIndex: 0,
            className: 'ws-theme' + (theme.id === activeTheme.id ? ' on' : ''),
            onClick: () => applyTheme(theme),
            onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); applyTheme(theme) } },
          },
          h(ThemeMiniPreview, { theme }),
          h('span', { className: 'ws-theme-meta' },
            h('span', { className: 'ws-theme-name-row' },
              h('span', { className: 'ws-theme-name' }, theme.name),
              h('button', {
                type: 'button',
                className: 'ws-theme-fav' + (favorites.includes(theme.id) ? ' on' : ''),
                title: favorites.includes(theme.id) ? t('取消收藏') : t('收藏主题'),
                onClick: event => { event.stopPropagation(); toggleFavorite(theme.id) },
              }, favorites.includes(theme.id) ? '★' : '☆'),
            ),
            h('span', { className: 'ws-theme-tag' }, theme.tagline.slice(0, 14)),
            fidelityFor(theme.id) !== null
              ? h('span', { className: 'ws-theme-fidelity', title: t('真实账号实测：{date}', { date: fidelityFor(theme.id).testedAt.slice(0, 10) }) }, `${t('实测')} ${fidelityFor(theme.id).score}`)
              : null,
          ),
          )),
        ),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('版式变体'))),
      h('div', { className: 'ws-variant-row' },
        activeTheme.variants.map(variant => h('button', {
          key: variant.id,
          type: 'button',
          className: 'ws-variant-card' + (variant.id === design.variantId ? ' on' : ''),
          onClick: () => setVariant(variant.id),
        },
        h('span', {
          className: 'ws-variant-mini',
          'data-title-style': variant.titleStyle,
          style: { background: activeTheme.palette.bg, borderColor: activeTheme.palette.border },
        },
        h('span', { className: 'ws-variant-title', style: { fontFamily: FONT_STACK[activeTheme.type.titleFont] ?? activeTheme.type.titleFont, color: activeTheme.palette.text } }, t('标题')),
        h('span', { className: 'ws-variant-rule', style: { background: activeTheme.palette.accent } }),
        h('span', { className: 'ws-variant-line', style: { background: activeTheme.palette.secondary } }),
        h('span', { className: 'ws-variant-line short', style: { background: activeTheme.palette.secondary } }),
        ),
        h('span', { className: 'ws-variant-name' }, variant.name),
        )),
      ),
      h('p', { className: 'ws-hint' }, activeTheme.tagline),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' },
        h('span', null, t('版式 DNA')),
        h('button', { type: 'button', className: 'ws-link', onClick: () => dnaInputRef.current?.click(), disabled: dnaBusy }, dnaBusy ? t('提取中…') : t('从参考图提取')),
      ),
      h('input', {
        ref: dnaInputRef,
        type: 'file',
        accept: 'image/*',
        style: { display: 'none' },
        onChange: readDnaFile,
      }),
      h('p', { className: 'ws-hint' }, t('传一张喜欢的文章截图，提取纸色、强调色和明暗，生成三个可套用的配方。')),
      dnaCandidates.length > 0
        ? h('div', { className: 'ws-dna-candidates' },
          dnaCandidates.map(candidate => h('div', {
            key: candidate.id,
            role: 'button',
            tabIndex: 0,
            className: 'ws-dna-card',
            onClick: () => applyDnaOverrides(candidate.overrides),
            onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); applyDnaOverrides(candidate.overrides) } },
          },
          h('span', { className: 'ws-dna-swatch', style: { background: candidate.overrides.bg, borderColor: candidate.overrides.accent } },
            h('i', { style: { background: candidate.overrides.accent } }),
          ),
          h('span', { className: 'ws-dna-name' }, candidate.label),
          h('span', { className: 'ws-dna-actions' },
            h('button', { type: 'button', className: 'ws-link', onClick: event => { event.stopPropagation(); saveDnaPreset(candidate) } }, t('存为我的版式')),
          ),
          )),
          h('input', { className: 'ws-input ws-dna-name-input', value: dnaName, placeholder: t('给这套版式起个名字（可选）'), onChange: event => setDnaName(event.target.value) }),
        )
        : null,
      dnaPresets.length > 0
        ? h('div', { className: 'ws-dna-presets' },
          dnaPresets.map(preset => h('div', { key: preset.id, className: 'ws-dna-preset' },
            h('span', { className: 'ws-dna-preset-name' }, preset.name),
            h('button', { type: 'button', className: 'ws-link', onClick: () => applyDnaOverrides(preset.overrides) }, t('套用')),
            h('button', { type: 'button', className: 'ws-link danger', onClick: () => removeDnaPreset(preset.id) }, t('删除')),
          )),
        )
        : null,
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('品牌包'))),
      h('p', { className: 'ws-hint' }, t('把收藏、最近主题、版式 DNA、写作规范和片段一起导出，换机器时导入即可。')),
      h('div', { className: 'ws-row' },
        h(Button, { onClick: exportBrandKit }, t('导出品牌包')),
        h(Button, { onClick: () => brandInputRef.current?.click() }, t('导入品牌包')),
        h('input', { ref: brandInputRef, type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: importBrandKit }),
      ),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('主色'))),
      h('div', { className: 'ws-swatches' },
        ACCENT_SWATCHES.map(color => h('button', {
          key: color,
          type: 'button',
          className: 'ws-swatch' + (color.toLowerCase() === design.colors.accent.toLowerCase() ? ' on' : ''),
          style: { background: color },
          title: color,
          onClick: () => setAccent(color),
        })),
        h('label', { className: 'ws-swatch ws-swatch-custom', title: t('自定义颜色') },
          h('input', { type: 'color', value: design.colors.accent, onChange: event => setAccent(event.target.value) }),
          h(Icon, { name: 'plus', size: 12 }),
        ),
      ),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('话题标签'))),
      h('input', {
        className: 'ws-input',
        value: doc.design?.overrides?.eyebrow ?? '',
        placeholder: t('例如：科技 / 生活 / 深度'),
        onChange: event => store.updateDesign(current => ({
          ...current,
          overrides: { ...(current.overrides ?? {}), eyebrow: event.target.value },
        })),
      }),
      h('p', { className: 'ws-hint' }, t('显示在标题上方的标签位：封面、环形与居中版式会用到。')),
    ),
  )
}

function formatSlider(value) {
  if (typeof value !== 'number') return String(value)
  return Number.isInteger(value) ? String(value) : value.toFixed(value < 0.1 ? 3 : 2)
}

const TYPE_OVERRIDE_KEYS = ['titleSize', 'bodySize', 'lineHeight', 'letterSpacing', 'paraGap', 'paddingX', 'sectionGap', 'titleGap', 'titleTracking']
const DECOR_OVERRIDE_KEYS = [
  'bg', 'bgStyle', 'ornament',
  'titleStyle', 'sectionStyle', 'quoteStyle', 'dividerStyle', 'listStyle', 'imageStyle',
  'imageWidth', 'imageAlign',
]

/** Remove only the given override keys, leaving accent/type/decor/display intact. */
function withoutOverrideKeys(design, keys) {
  const overrides = { ...(design?.overrides ?? {}) }
  for (const key of keys) delete overrides[key]
  return { ...design, overrides }
}

function TypeSection(props) {
  const { store, design, doc, parsed, toast } = props
  const set = (patch) => store.updateDesign(current => ({ ...current, overrides: { ...(current.overrides ?? {}), ...patch } }))
  const guide = normalizeStyleGuide(doc.meta.styleGuide)
  const updateGuide = (patch) => store.updateMeta({ styleGuide: normalizeStyleGuide({ ...guide, ...patch }) })
  const rows = [
    { key: 'titleSize', label: t('标题字号'), value: design.type.titleSize, min: 20, max: 40, step: 1, unit: 'px' },
    { key: 'bodySize', label: t('正文字号'), value: design.type.bodySize, min: 13, max: 20, step: 0.5, unit: 'px' },
    { key: 'lineHeight', label: t('正文行高'), value: design.type.lineHeight, min: 1.5, max: 2.4, step: 0.05, unit: '' },
    { key: 'letterSpacing', label: t('字间距'), value: design.type.letterSpacing, min: 0, max: 0.06, step: 0.005, unit: 'em' },
    { key: 'paraGap', label: t('段间距'), value: design.type.paraGap, min: 10, max: 40, step: 1, unit: 'px' },
    { key: 'paddingX', label: t('左右留白'), value: design.layout.paddingX, min: 8, max: 28, step: 1, unit: 'px' },
  ]
  const reset = () => {
    store.updateDesign(current => withoutOverrideKeys(current, TYPE_OVERRIDE_KEYS))
    toast(t('已恢复当前主题的默认排版'))
  }
  const theme = THEMES.find(entry => entry.id === design.themeId) ?? THEMES[0]
  const base = theme.type
  const round2 = value => Math.round(value * 100) / 100
  const presetSpecs = [
    {
      id: 'compact',
      label: t('紧凑'),
      values: {
        bodySize: base.bodySize,
        lineHeight: round2(Math.max(1.5, base.lineHeight - 0.08)),
        letterSpacing: parseFloat(base.letterSpacing) || 0,
        paraGap: Math.max(10, base.paraGap - 4),
        paddingX: Math.max(8, base.paddingX - 2),
      },
    },
    { id: 'standard', label: t('标准'), values: null },
    {
      id: 'relaxed',
      label: t('舒展'),
      values: {
        bodySize: base.bodySize,
        lineHeight: round2(Math.min(2.4, base.lineHeight + 0.12)),
        letterSpacing: parseFloat(base.letterSpacing) || 0,
        paraGap: Math.min(40, base.paraGap + 6),
        paddingX: Math.min(28, base.paddingX + 2),
      },
    },
    {
      id: 'magazine',
      label: t('杂志'),
      values: {
        titleSize: Math.min(40, base.titleSize + 2),
        bodySize: Math.min(20, base.bodySize + 0.5),
        lineHeight: round2(Math.min(2.4, base.lineHeight + 0.18)),
        letterSpacing: parseFloat(base.letterSpacing) || 0,
        paraGap: Math.min(40, base.paraGap + 10),
        paddingX: Math.min(28, base.paddingX + 2),
      },
    },
  ]
  const rawOverrides = store.doc.design?.overrides ?? {}
  const matchesPreset = (values) => {
    if (values === null) return TYPE_OVERRIDE_KEYS.every(key => !(key in rawOverrides))
    return Object.entries(values).every(([key, value]) => {
      const current = key === 'paddingX' ? design.layout.paddingX : design.type[key]
      return Math.abs(Number(current) - Number(value)) < 0.011
    })
  }
  const applyPreset = (spec) => {
    if (spec.values === null) {
      store.updateDesign(current => withoutOverrideKeys(current, TYPE_OVERRIDE_KEYS))
    } else {
      store.updateDesign(current => ({ ...current, overrides: { ...(current.overrides ?? {}), ...spec.values } }))
    }
    toast(t('已应用排版预设：{name}', { name: spec.label }))
  }
  const audit = React.useMemo(() => auditTypography(parsed.blocks, doc.text), [parsed.blocks, doc.text])
  const fixable = audit.longParagraphs > 0 || audit.halfWidthPunctuation > 0 || audit.extraBlankLines > 0
  const applyTextFix = (next, message) => {
    if (next === doc.text) { toast(t('没有需要修正的内容')); return }
    store.updateDoc(current => ({ ...current, text: next }))
    toast(message)
  }
  const fixLong = () => applyTextFix(splitLongParagraphs(doc.text), t('已拆分长段落'))
  const fixPunctuation = () => applyTextFix(normalizeCjkPunctuation(doc.text), t('已统一中文标点'))
  const fixBlank = () => applyTextFix(tidyMarkdown(doc.text), t('已整理多余空行'))
  const fixAll = () => applyTextFix(tidyMarkdown(normalizeCjkPunctuation(splitLongParagraphs(doc.text))), t('已整理正文'))
  return h('div', { className: 'ws-sections' },
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('排版预设'))),
      h('div', { className: 'ws-preset-row' },
        presetSpecs.map(spec => h('button', {
          key: spec.id,
          type: 'button',
          className: 'ws-chip' + (matchesPreset(spec.values) ? ' on' : ''),
          onClick: () => applyPreset(spec),
        }, spec.label)),
      ),
      h('p', { className: 'ws-hint' }, t('按主题比例一键切换字号、行高、段距与留白，下面仍可继续微调。')),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' },
        h('span', null, t('排版体检')),
        fixable ? h('button', { type: 'button', className: 'ws-link', onClick: fixAll }, t('一键整理')) : null,
      ),
      h('div', { className: 'ws-audit-list' },
        h('div', { className: 'ws-audit-row' + (audit.longParagraphs > 0 ? ' warn' : '') },
          h('span', null, t('长段落')),
          h('span', { className: 'ws-audit-count' }, audit.longParagraphs),
          audit.longParagraphs > 0 ? h('button', { type: 'button', className: 'ws-link', onClick: fixLong }, t('拆分')) : null,
        ),
        h('div', { className: 'ws-audit-row' + (audit.halfWidthPunctuation > 0 ? ' warn' : '') },
          h('span', null, t('半角标点')),
          h('span', { className: 'ws-audit-count' }, audit.halfWidthPunctuation),
          audit.halfWidthPunctuation > 0 ? h('button', { type: 'button', className: 'ws-link', onClick: fixPunctuation }, t('统一')) : null,
        ),
        h('div', { className: 'ws-audit-row' + (audit.extraBlankLines > 0 ? ' warn' : '') },
          h('span', null, t('多余空行')),
          h('span', { className: 'ws-audit-count' }, audit.extraBlankLines),
          audit.extraBlankLines > 0 ? h('button', { type: 'button', className: 'ws-link', onClick: fixBlank }, t('整理')) : null,
        ),
        h('div', { className: 'ws-audit-row' + (audit.highlights > 8 ? ' warn' : '') },
          h('span', null, t('高亮标记')),
          h('span', { className: 'ws-audit-count' }, audit.highlights),
        ),
        h('div', { className: 'ws-audit-row' + (audit.missingCaptions > 0 ? ' warn' : '') },
          h('span', null, t('缺图注')),
          h('span', { className: 'ws-audit-count' }, audit.missingCaptions),
        ),
        h('div', { className: 'ws-audit-row' + (audit.headingSkips > 0 ? ' warn' : '') },
          h('span', null, t('标题层级跳级')),
          h('span', { className: 'ws-audit-count' }, audit.headingSkips),
        ),
      ),
      h('p', { className: 'ws-hint' }, t('图注即图片说明（alt），标题层级跳级需要手动调整。')),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('编辑部规范')), h('span', { className: 'ws-group-note' }, t('随文档保存'))),
      h('div', { className: 'ws-chips' },
        [['restrained', t('克制')], ['spoken', t('口语')], ['professional', t('专业')], ['story', t('故事')]].map(([id, label]) => h('button', {
          key: id,
          type: 'button',
          className: 'ws-chip' + (guide.tone === id ? ' on' : ''),
          onClick: () => updateGuide({ tone: id }),
        }, label)),
      ),
      h('div', { className: 'ws-field-row' },
        h('span', { className: 'ws-field-label' }, t('禁用词')),
        h('input', { className: 'ws-input', value: guide.bannedWords.join('、'), placeholder: t('用逗号分隔，例如：赋能、抓手'), onChange: event => updateGuide({ bannedWords: event.target.value }) }),
      ),
      h('div', { className: 'ws-field-row' },
        h('span', { className: 'ws-field-label' }, t('偏好词')),
        h('input', { className: 'ws-input', value: guide.preferredWords.join('、'), placeholder: t('希望出现的称呼或术语'), onChange: event => updateGuide({ preferredWords: event.target.value }) }),
      ),
      h('div', { className: 'ws-field-row' },
        h('span', { className: 'ws-field-label' }, t('段落上限')),
        h('input', { className: 'ws-input ws-input-narrow', type: 'number', min: 60, max: 400, value: guide.maxParagraphChars, onChange: event => updateGuide({ maxParagraphChars: Number(event.target.value) }) }),
        h('span', { className: 'ws-hint' }, t('字')),
      ),
      h(Toggle, { label: t('正文图片必须带图注'), checked: guide.requireCaptions, onChange: value => updateGuide({ requireCaptions: value }) }),
      h('p', { className: 'ws-hint' }, t('规范会随文档保存，AI 修改和发布检查都会读取。')),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('字号与节奏')), h('button', { type: 'button', className: 'ws-link', onClick: reset }, t('恢复默认'))),
      rows.map(row => h('div', { key: row.key, className: 'ws-slider-row' },
        h('span', { className: 'ws-slider-label' }, row.label),
        h('input', {
          type: 'range',
          'aria-label': row.label,
          min: row.min,
          max: row.max,
          step: row.step,
          value: row.value,
          onChange: event => set({ [row.key]: Number(event.target.value) }),
        }),
        h('span', { className: 'ws-slider-value' }, formatSlider(row.value) + row.unit),
      )),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('阅读体验'))),
      h('ul', { className: 'ws-checklist' },
        h('li', null, `正文 ${design.type.bodySize}px，在手机上大约每行 ${Math.round(300 / design.type.bodySize)} 个字`),
        h('li', null, `行高 ${design.type.lineHeight}，段间距 ${design.type.paraGap}px`),
        h('li', null, t('字号超过 17px 后，列表和图片建议同步放大')),
      ),
    ),
  )
}

const DECOR_OPTIONS = {
  titleStyle: [
    ['rule', t('通栏细线')], ['kicker', t('刊头 + 大标题')], ['ribbon', t('色块标题')], ['tag', t('标签 + 标题')], ['boxed', t('边框卡片')],
    ['vertical', t('左侧竖线')], ['underline', t('下划短线')], ['centered', t('居中 + 短线')], ['eyebrow', t('眉标 + 大标题')],
  ],
  sectionStyle: [
    ['bar', t('左侧色条')], ['rule', t('横线 + 编号')], ['tag', t('色块标签')], ['numbered', t('章节编号')], ['line', t('居中细线')], ['dot', t('圆点')], ['ghost', t('大号数字')],
  ],
  quoteStyle: [
    ['bar', t('左侧竖线')], ['pull', t('上下细线')], ['card', t('卡片')], ['center', t('居中引号')], ['tint', t('浅色底')], ['stamp', t('描边摘录')],
  ],
  dividerStyle: [
    ['dots', t('三点')], ['diamond', t('菱形')], ['ornament', t('花饰')], ['line', t('细线')], ['dash', t('虚线')], ['none', t('留白')],
  ],
  listStyle: [
    ['dot', t('圆点')], ['num', t('序号')], ['square', t('方块')], ['arrow', t('箭头')],
  ],
  imageStyle: [
    ['plain', t('直角')], ['rounded', t('圆角')], ['shadow', t('投影')], ['frame', t('细框')], ['polaroid', t('拍立得')], ['full', t('通栏出血')],
  ],
}

function DecorSection(props) {
  const { store, design, toast } = props
  const set = (patch) => store.updateDesign(current => ({ ...current, overrides: { ...(current.overrides ?? {}), ...patch } }))
  const resetDecor = () => {
    store.updateDesign(current => withoutOverrideKeys(current, DECOR_OVERRIDE_KEYS))
    toast('已恢复主题默认装饰')
  }
  const surface = design.surface ?? { bg: design.themeBg, pattern: 'none', ornament: 'none' }
  const bgValue = surface.bg === design.themeBg ? '' : surface.bg
  return h('div', { className: 'ws-sections' },
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('背景与图形'))),
      h('div', { className: 'ws-bg-row' },
        BG_CHOICES.map(([value, label]) => h('button', {
          key: label,
          type: 'button',
          className: 'ws-bg-swatch' + (bgValue === value ? ' on' : ''),
          title: label,
          style: { background: value === '' ? design.themeBg : value },
          onClick: () => set({ bg: value === '' ? null : value }),
        })),
      ),
      h('label', { className: 'ws-field' },
        h('span', { className: 'ws-field-label' }, t('底纹')),
        h('select', { className: 'ws-input', value: surface.pattern, onChange: event => set({ bgStyle: event.target.value }) },
          BG_PATTERNS.map(([value, label]) => h('option', { key: value, value }, label))),
      ),
      h('label', { className: 'ws-field' },
        h('span', { className: 'ws-field-label' }, t('矢量角标')),
        h('select', { className: 'ws-input', value: surface.ornament, onChange: event => set({ ornament: event.target.value }) },
          ORNAMENTS.map(([value, label]) => h('option', { key: value, value }, label))),
      ),
      h('div', { className: 'ws-hint' }, t('底纹与角标都会写进复制/发布的 HTML；深色背景会自动换成浅色文字。')),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('形状与装饰')), h('button', { type: 'button', className: 'ws-link', onClick: resetDecor }, t('恢复默认'))),
      Object.entries(DECOR_OPTIONS).map(([key, options]) => h('label', { key, className: 'ws-field' },
        h('span', { className: 'ws-field-label' }, ({
          titleStyle: t('标题样式'), sectionStyle: t('章节样式'), quoteStyle: t('引用样式'),
          dividerStyle: t('分割线'), listStyle: t('列表符号'), imageStyle: t('图片样式'),
        })[key]),
        h('select', {
          className: 'ws-input',
          value: design.decor[key],
          onChange: event => set({ [key]: event.target.value }),
        }, options.map(([value, label]) => h('option', { key: value, value }, label))),
      )),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('图片'))),
      h('label', { className: 'ws-field' },
        h('span', { className: 'ws-field-label' }, t('宽度')),
        h('select', { className: 'ws-input', value: String(design.decor.imageWidth), onChange: event => set({ imageWidth: Number(event.target.value) }) },
          [['100', t('通栏')], ['85', t('大图')], ['70', t('中等')], ['50', t('小图')]].map(([value, label]) => h('option', { key: value, value }, label))),
      ),
      h('label', { className: 'ws-field' },
        h('span', { className: 'ws-field-label' }, t('对齐')),
        h('select', { className: 'ws-input', value: design.decor.imageAlign, onChange: event => set({ imageAlign: event.target.value }) },
          [['center', t('居中')], ['left', t('左对齐')], ['right', t('右对齐')]].map(([value, label]) => h('option', { key: value, value }, label))),
      ),
      h('p', { className: 'ws-hint' }, t('图片样式选「通栏」时会忽略宽度。悬停图片可以点工具条里的图标换图。')),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('显示项'))),
      h(Toggle, { label: t('标题下方显示作者与日期'), checked: design.decor.showMeta, onChange: value => set({ showMeta: value }) }),
      h(Toggle, { label: t('话题标签'), checked: design.decor.showEyebrow, onChange: value => set({ showEyebrow: value }) }),
      h(Toggle, { label: t('首段作为导语放大'), checked: design.decor.lead, onChange: value => set({ lead: value }) }),
      h(Toggle, { label: t('显示文末引导'), checked: design.decor.showFooter, onChange: value => set({ showFooter: value }) }),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('文末签名'))),
      h('textarea', {
        className: 'ws-input ws-textarea',
        rows: 2,
        value: design.decor.footerText,
        onChange: event => set({ footerText: event.target.value }),
        placeholder: t('写给读者的结束语'),
      }),
      h('input', {
        className: 'ws-input',
        value: design.decor.footerSign,
        placeholder: t('署名，例如：文 / 张三'),
        onChange: event => set({ footerSign: event.target.value }),
      }),
    ),
  )
}

/* ------------------------------------------------------------------ *
 * Publish flow
 * ------------------------------------------------------------------ */

function PublishSection(props) {
  const { store, design, doc, parsed, article, features, hostStatus, setHostStatus, toast, takeSnapshot, snapshotVersion } = props
  const [configOpen, setConfigOpen] = React.useState(false)
  const [appId, setAppId] = React.useState('')
  const [appSecret, setAppSecret] = React.useState('')
  const [configBusy, setConfigBusy] = React.useState(false)
  const [accounts, setAccounts] = React.useState({ items: [], activeId: '' })
  const [accountName, setAccountName] = React.useState('')
  const [steps, setSteps] = React.useState([])
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [confirmPublish, setConfirmPublish] = React.useState(false)
  const [coverBusy, setCoverBusy] = React.useState(false)
  const [bundleIds, setBundleIds] = React.useState([])
  const [draftBox, setDraftBox] = React.useState({ phase: 'idle', items: [], total: 0, offset: 0, error: '' })
  const [draftQuery, setDraftQuery] = React.useState('')
  const [draftBusy, setDraftBusy] = React.useState(false)
  const [deleteArm, setDeleteArm] = React.useState('')
  const [importingDraft, setImportingDraft] = React.useState('')
  const [snapshots, setSnapshots] = React.useState([])
  const [snapshotBusy, setSnapshotBusy] = React.useState(false)
  const [compareSnapshot, setCompareSnapshot] = React.useState(null)
  const [ledger, setLedger] = React.useState([])
  const [ledgerVersion, setLedgerVersion] = React.useState(0)
  const [compareLedger, setCompareLedger] = React.useState(null)
  const [stats, setStats] = React.useState({ phase: 'idle', items: [], days: 7, error: '' })
  const [statsBusy, setStatsBusy] = React.useState(false)
  const [networkState, setNetworkState] = React.useState({ phase: 'loading', mode: 'system', proxyUrl: '', error: '' })
  const [networkMode, setNetworkMode] = React.useState('system')
  const [networkProxy, setNetworkProxy] = React.useState('')
  const [networkBusy, setNetworkBusy] = React.useState(false)
  const [egress, setEgress] = React.useState(null)
  const [networkAdvanced, setNetworkAdvanced] = React.useState(false)
  const [wechatProbe, setWechatProbe] = React.useState(null)
  const [wechatBusy, setWechatBusy] = React.useState(false)
  React.useEffect(() => {
    let cancelled = false
    callHost('networkStatus')
      .then((value) => {
        if (cancelled) return
        const mode = value?.mode === 'proxy' ? 'proxy' : 'system'
        setNetworkState({ phase: 'ready', mode, proxyUrl: typeof value?.proxyUrl === 'string' ? value.proxyUrl : '', error: '' })
        setNetworkMode(mode)
      })
      .catch((failure) => {
        if (cancelled) return
        setNetworkState({ phase: 'error', mode: 'system', proxyUrl: '', error: failure.message || '' })
      })
    return () => { cancelled = true }
  }, [])
  const deleteArmTimer = React.useRef(undefined)
  React.useEffect(() => () => clearTimeout(deleteArmTimer.current), [])
  const coverInputRef = React.useRef(null)
  const title = (doc.meta.title.trim() || parsed.title || '').trim()
  const savedMediaId = typeof doc.meta.draftMediaId === 'string' ? doc.meta.draftMediaId.trim() : ''
  const savedArticleCount = Number(doc.meta.draftArticleCount) || 0
  const author = doc.meta.author.trim()
  const digest = doc.meta.digest.trim() || deriveDigest(parsed.blocks)
  const coverDataUrl = doc.meta.coverDataUrl || ''
  const coverLayout = typeof doc.meta.coverLayout === 'string' ? doc.meta.coverLayout : 'left'

  const refreshSnapshots = React.useCallback(async () => {
    try { setSnapshots(await listSnapshots(doc.id, 8)) } catch { setSnapshots([]) }
  }, [doc.id])
  React.useEffect(() => { refreshSnapshots() }, [refreshSnapshots, snapshotVersion])
  React.useEffect(() => {
    let cancelled = false
    listLedgerEvents(doc.id, 20).then(items => { if (!cancelled) setLedger(items) }).catch(() => { if (!cancelled) setLedger([]) })
    return () => { cancelled = true }
  }, [doc.id, ledgerVersion])
  const loadArticleStats = async () => {
    setStatsBusy(true)
    try {
      const value = await callHost('articleStats', { days: 7 }, { timeoutMs: 60000 })
      setStats({ phase: 'ready', items: Array.isArray(value.items) ? value.items : [], days: value.days ?? 7, error: '' })
    } catch (failure) {
      setStats({ phase: 'error', items: [], days: 7, error: localizeError(failure.code, failure.message || t('读取发布数据失败')) })
    } finally {
      setStatsBusy(false)
    }
  }

  const recordLedger = async (type, extra = {}) => {
    const current = store.getDoc()
    if (!current) return
    await appendLedgerEvent({
      docId: current.id,
      type,
      title: current.meta.title.trim() || parsed.title || '',
      theme: `${design.themeName} · ${design.variantName}`,
      text: current.text,
      design: current.design,
      meta: current.meta,
      ...extra,
    })
    setLedgerVersion(value => value + 1)
  }
  const saveManualSnapshot = async () => {
    if (typeof takeSnapshot !== 'function') return
    setSnapshotBusy(true)
    try {
      await takeSnapshot('manual', true)
      await refreshSnapshots()
    } finally {
      setSnapshotBusy(false)
    }
  }
  const restoreSnapshot = async (snapshot) => {
    if (typeof takeSnapshot === 'function') await takeSnapshot('before-restore')
    store.updateDoc(current => ({
      ...current,
      text: snapshot.text,
      design: snapshot.design,
      meta: { ...current.meta, ...snapshot.meta },
    }))
    setCompareSnapshot(null)
    toast(t('已恢复快照'))
  }

  const ledgerLabel = (type) => type === 'published' ? t('已发布') : type === 'updated' ? t('草稿更新') : t('草稿保存')
  const restoreLedger = (event) => {
    store.updateDoc(current => ({
      ...current,
      text: event.text,
      design: event.design,
      meta: { ...current.meta, ...event.meta },
    }))
    setCompareLedger(null)
    toast(t('已恢复到这条发布记录'))
  }

  const previewHtmlLength = React.useMemo(() => serializeNodes(article.nodes).length, [article])

  const houseStyle = React.useMemo(() => auditHouseStyle(parsed.blocks, doc.text, doc.meta.styleGuide), [parsed.blocks, doc.text, doc.meta.styleGuide])

  const preflight = React.useMemo(() => {
    const checks = []
    const push = (level, label, detail) => checks.push({ level, label, detail })
    const formatSize = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`
    if (title === '') push('error', t('标题为空'), t('先填标题再保存或发布'))
    else if (title.length > 64) push('warn', t('标题超过 64 字，保存时会被截断'), `${title.length}/64`)
    if (author.length > 8) push('warn', t('作者超过 8 字，保存时会被截断'), `${author.length}/8`)
    if (digest.length > 120) push('warn', t('摘要超过 120 字，保存时会被截断'), `${digest.length}/120`)
    if (!hostStatus.configured) push('warn', t('公众号还没配置'), t('保存/发布前先填写 AppID 和 AppSecret'))
    if (hasUnresolvedImageRefs(doc.text)) push('error', t('有图片还没从本地图库加载完'), t('等一秒再试'))
    const dataImages = collectDataImages(article.nodes)
    if (dataImages.length > 0) {
      const bytes = dataImages.reduce((sum, url) => sum + Math.floor((url.length * 3) / 4), 0)
      if (bytes > 6 * 1024 * 1024) push('warn', t('图片原始体积约 {size}，发布前会压缩', { size: formatSize(bytes) }), t('建议删减几张'))
      else push('ok', t('正文图片 {count} 张', { count: dataImages.length }), t('发布时自动上传'))
    }
    const remoteImages = collectRemoteImages(article.nodes)
    if (remoteImages.length > 0) {
      if (remoteImages.some(url => !/^https:/i.test(url))) push('warn', t('外链图片建议使用 HTTPS'), `${remoteImages.length}`)
      else push('ok', t('外链图片 {count} 张，发布时会转存', { count: remoteImages.length }), '')
    }
    const htmlLength = previewHtmlLength
    if (htmlLength > 950 * 1024) push('error', t('正文 HTML 超过 950KB，删掉图片或缩短正文'), formatSize(htmlLength))
    else if (htmlLength > 800 * 1024) push('warn', t('正文 HTML 约 {size}，接近微信上限', { size: formatSize(htmlLength) }), '')
    if (houseStyle.bannedHits.length > 0) push('warn', t('禁用词出现 {count} 次', { count: houseStyle.bannedHits.reduce((sum, item) => sum + item.count, 0) }), houseStyle.bannedHits.map(item => item.word).join('、'))
    if (houseStyle.longParagraphs > 0) push('warn', t('超过段落上限 {count} 段', { count: houseStyle.longParagraphs }), `${houseStyle.guide.maxParagraphChars} ${t('字')}`)
    if (houseStyle.missingCaptions > 0) push('warn', t('缺图注 {count} 张', { count: houseStyle.missingCaptions }), t('规范要求正文图片带图注'))
    const measured = fidelityFor(doc.design.themeId)
    if (measured === null) push('warn', t('这个主题还没有真实账号实测'), '')
    else if (measured.ok) push('ok', t('主题实测保真 {score}', { score: measured.score }), `${measured.testedAt.slice(0, 10)} · ${t('真实草稿读回')}`)
    else push('warn', t('主题实测保真 {score}', { score: measured.score }), t('有样式在微信端被清洗'))
    if (coverDataUrl !== '' || doc.meta.coverCustom === true) push('ok', t('封面已就绪'), '')
    else push('warn', t('封面还在生成'), t('等封面出现或手动上传'))
    if (bundleIds.length > 0) push('ok', t('合集共 {count} 篇', { count: bundleIds.length + 1 }), t('保存时会逐篇上传'))
    return checks
  }, [previewHtmlLength, article, title, author, digest, hostStatus.configured, coverDataUrl, doc.text, doc.meta.coverCustom, bundleIds.length, doc.design.themeId, houseStyle])

  const qa = React.useMemo(() => {
    const errors = preflight.filter(item => item.level === 'error').length
    const warnings = preflight.filter(item => item.level === 'warn').length
    const aiHashes = Array.isArray(doc.meta.aiHashes) ? doc.meta.aiHashes : []
    const lockedHashes = Array.isArray(doc.meta.lockedHashes) ? doc.meta.lockedHashes : []
    const aiCount = parsed.blocks.filter(block => aiHashes.includes(hashBlock(block.text))).length
    const lockedCount = parsed.blocks.filter(block => lockedHashes.includes(hashBlock(block.text))).length
    const titleText = title
    const digestText = digest
    const distributionCount = (titleText.length > 36 ? 1 : 0) + (digestText.length > 54 ? 1 : 0) + (coverDataUrl === '' ? 1 : 0)
    const issues = errors + warnings + houseStyle.violations + distributionCount
    const status = errors > 0 ? 'blocked' : issues > 0 ? 'review' : 'ready'
    return { errors, warnings, aiCount, lockedCount, distributionCount, issues, status }
  }, [preflight, parsed.blocks, doc.meta.aiHashes, doc.meta.lockedHashes, title, digest, coverDataUrl, houseStyle])

  React.useEffect(() => {
    // Keep the generated cover in step with the current theme; a cover the user
    // uploaded themselves stays untouched.
    if (doc.meta.coverCustom === true) return
    try {
      const generated = renderCover({ title, design, layout: coverLayout })
      if (generated !== coverDataUrl) store.updateMeta({ coverDataUrl: generated })
    } catch {
      // Canvas may be unavailable in unusual embedders; the publish step reports it.
    }
  }, [title, design.themeId, design.variantId, design.colors.accent, coverDataUrl, doc.meta.coverCustom, coverLayout])

  const regenerateCover = () => {
    try {
      store.updateMeta({ coverDataUrl: renderCover({ title, design, layout: coverLayout }), coverCustom: false })
      toast('已按新主题重绘封面')
    } catch (failure) {
      toast(failure.message || t('封面生成失败'), 'error')
    }
  }

  const uploadCoverFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setCoverBusy(true)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const cropped = await cropToCover(dataUrl)
      store.updateMeta({ coverDataUrl: cropped, coverCustom: true })
      toast(t('已换成你上传的封面'), 'success')
    } catch (failure) {
      toast(failure.message || t('封面处理失败'), 'error')
    } finally {
      setCoverBusy(false)
    }
  }

  const loadAccounts = async () => {
    try {
      const value = await callHost('listAccounts')
      setAccounts({ items: Array.isArray(value.accounts) ? value.accounts : [], activeId: value.activeId ?? '' })
    } catch {
      setAccounts({ items: [], activeId: '' })
    }
  }
  React.useEffect(() => { if (hostStatus.configured) loadAccounts() }, [hostStatus.configured])

  const makeActive = (value) => {
    const active = (value.accounts ?? []).find(item => item.active) ?? (value.accounts ?? []).find(item => item.id === value.activeId)
    setAccounts({ items: Array.isArray(value.accounts) ? value.accounts : [], activeId: value.activeId ?? '' })
    setHostStatus(current => ({
      ...current,
      phase: 'ready',
      configured: active !== undefined,
      appIdPreview: active?.appIdPreview ?? null,
      message: '',
    }))
  }

  const switchAccount = async (id) => {
    setConfigBusy(true)
    try {
      const value = await callHost('switchAccount', { id })
      makeActive(value)
      toast(t('已切换公众号账号'), 'success')
    } catch (failure) {
      toast(failure.message || t('切换账号失败'), 'error')
    } finally {
      setConfigBusy(false)
    }
  }

  const removeAccount = async (id) => {
    setConfigBusy(true)
    try {
      const value = await callHost('removeAccount', { id })
      makeActive(value)
      toast(t('账号已删除'))
    } catch (failure) {
      toast(failure.message || t('删除账号失败'), 'error')
    } finally {
      setConfigBusy(false)
    }
  }

  const saveConfig = async () => {
    setConfigBusy(true)
    try {
      const value = await callHost('saveAccount', { name: accountName.trim(), appId: appId.trim(), appSecret: appSecret.trim(), activate: true })
      makeActive(value)
      setConfigOpen(false)
      setAccountName('')
      setAppId('')
      setAppSecret('')
      toast(t('公众号账号已保存到本机凭据库'), 'success')
    } catch (failure) {
      toast(failure.message || t('保存失败'), 'error')
    } finally {
      setConfigBusy(false)
    }
  }

  const testConnection = async () => {
    setConfigBusy(true)
    try {
      const value = await callHost('testConnection')
      toast(`连接成功，access_token 有效 ${Math.round((value.expiresIn ?? 7200) / 60)} 分钟`, 'success')
    } catch (failure) {
      if (failure?.detail?.ip) setEgress({ ip: failure.detail.ip, ms: 0 })
      toast(localizeError(failure.code, failure.message || t('连接失败')), 'error')
    } finally {
      setConfigBusy(false)
    }
  }

  const saveNetworkSettings = async () => {
    setNetworkBusy(true)
    try {
      const value = await callHost('saveNetwork', { mode: networkMode, proxyUrl: networkProxy })
      const mode = value?.mode === 'proxy' ? 'proxy' : 'system'
      setNetworkState({ phase: 'ready', mode, proxyUrl: typeof value?.proxyUrl === 'string' ? value.proxyUrl : '', error: '' })
      setNetworkMode(mode)
      setNetworkProxy('')
      toast(t('代理设置已保存'), 'success')
    } catch (failure) {
      toast(localizeError(failure.code, failure.message || t('代理设置保存失败')), 'error')
    } finally {
      setNetworkBusy(false)
    }
  }

  const probeWechatEgress = async () => {
    setWechatBusy(true)
    try {
      const value = await callHost('probeWechatEgress', { samples: 3 }, { timeoutMs: 60000 })
      setWechatProbe(value)
      if (value?.changing === true) toast(t('微信出口 IP 在变化，白名单会一直失效'), 'error')
      else if (value?.whitelisted === true) toast(t('微信接口连接正常，当前出口已在白名单'), 'success')
      else if (Array.isArray(value?.ips) && value.ips.length > 0) toast(t('微信看到的出口 IP：{ips}', { ips: value.ips.join(' / ') }), 'success')
    } catch (failure) {
      toast(localizeError(failure.code, failure.message || t('检测微信出口失败')), 'error')
    } finally {
      setWechatBusy(false)
    }
  }

  const copyEgressIp = async () => {
    const ip = egress?.ip
    if (typeof ip !== 'string' || ip === '') return
    try {
      await navigator.clipboard.writeText(ip)
      toast(t('已复制出口 IP'), 'success')
    } catch {
      toast(t('复制失败，请手动选中 IP'), 'error')
    }
  }

  const copyWechatIp = async () => {
    const ip = Array.isArray(wechatProbe?.ips) ? wechatProbe.ips[0] : ''
    if (typeof ip !== 'string' || ip === '') return
    try {
      await navigator.clipboard.writeText(ip)
      toast(t('已复制出口 IP'), 'success')
    } catch {
      toast(t('复制失败，请手动选中 IP'), 'error')
    }
  }

  const probeNetworkEgress = async () => {
    setNetworkBusy(true)
    setEgress(null)
    try {
      const value = await callHost('probeNetwork', { mode: networkMode, proxyUrl: networkProxy })
      setEgress(value)
    } catch (failure) {
      toast(localizeError(failure.code, failure.message || t('出口检测失败')), 'error')
    } finally {
      setNetworkBusy(false)
    }
  }

  const clearConfig = async () => {
    setConfigBusy(true)
    try {
      await callHost('clearConfig')
      setAccounts({ items: [], activeId: '' })
      setHostStatus({ phase: 'ready', configured: false, appIdPreview: null, message: '' })
      toast('已清除本机保存的公众号密钥')
    } catch (failure) {
      toast(failure.message || t('清除失败'), 'error')
    } finally {
      setConfigBusy(false)
    }
  }

  const loadDrafts = async (offset = 0) => {
    setDraftBusy(true)
    try {
      const value = await callHost('listDrafts', { count: 10, offset })
      setDraftBox({
        phase: 'ready',
        items: Array.isArray(value.items) ? value.items : [],
        total: Number(value.totalCount) || 0,
        offset,
        error: '',
      })
    } catch (failure) {
      setDraftBox({ phase: 'error', items: [], total: 0, offset, error: failure.message || t('读取草稿箱失败') })
    } finally {
      setDraftBusy(false)
    }
  }

  const removeDraft = async (mediaId) => {
    if (deleteArm !== mediaId) {
      setDeleteArm(mediaId)
      clearTimeout(deleteArmTimer.current)
      deleteArmTimer.current = setTimeout(() => setDeleteArm(''), 4000)
      return
    }
    clearTimeout(deleteArmTimer.current)
    setDeleteArm('')
    try {
      await callHost('deleteDraft', { mediaId })
      setDraftBox(current => ({ ...current, items: current.items.filter(item => item.mediaId !== mediaId), total: Math.max(0, current.total - 1) }))
      toast(t('草稿已删除'))
    } catch (failure) {
      toast(failure.message || t('删除失败'), 'error')
    }
  }

  const importDraft = async (item) => {
    setImportingDraft(item.mediaId)
    try {
      const value = await callHost('getDraft', { mediaId: item.mediaId }, { timeoutMs: 60000 })
      const articles = Array.isArray(value.items) ? value.items : []
      let imported = 0
      for (const article of articles) {
        const markdown = htmlToMarkdown(article.content ?? '').trim()
        if (markdown.length < 20) continue
        const parsedImport = parseArticle(markdown)
        const designImport = autoCompose(parsedImport.blocks, markdown, 0).design
        store.addDoc(markdown, designImport, {
          title: article.title || parsedImport.title || '',
          author: article.author || '',
          digest: article.digest || '',
          sourceUrl: article.contentSourceUrl || '',
          needOpenComment: article.needOpenComment === true,
          onlyFansCanComment: article.onlyFansCanComment === true,
        })
        imported += 1
      }
      if (imported === 0) throw Object.assign(new Error(t('这篇草稿里没有可导入的正文')), { code: 'draft-empty' })
      toast(t('已导入 {count} 篇草稿', { count: imported }), 'success')
    } catch (failure) {
      toast(localizeError(failure.code, failure.message || t('草稿导入失败')), 'error')
    } finally {
      setImportingDraft('')
    }
  }

  const runPublish = async (mode) => {
    if (hasUnresolvedImageRefs(doc.text)) { toast('正文图片还在从本地图库读取，等一秒再发布。', 'error'); return }
    if (title === '') { toast('先填文章标题', 'error'); return }
    setBusy(true)
    setConfirmPublish(false)
    setResult(null)
    setError(null)
    setSteps([])
    if (typeof takeSnapshot === 'function') await takeSnapshot('before-publish')
    const push = (label, state, detail) => setSteps(list => [...list, { label, state, detail }])
    const markLastDone = () => setSteps(list => list.map((step, index) => (index === list.length - 1 ? { ...step, state: 'done' } : step)))

    try {
      if (!hostStatus.configured) {
        throw Object.assign(new Error(t('还没有配置公众号 AppID / AppSecret')), { code: 'not-configured' })
      }
      push(t('检查公众号配置'), 'done')

      const extras = bundleIds
        .map(id => store.docs.find(entry => entry.id === id))
        .filter(entry => entry !== undefined && entry.id !== doc.id)
        .slice(0, 7)
      const entries = [doc, ...extras]
      const preparedArticles = []

      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]
        const prefix = entries.length > 1 ? `第 ${index + 1} 篇：` : ''
        const text = expandImageRefs(entry.text)
        const parsedEntry = parseArticle(text)
        const designEntry = composeDesign(entry.design)
        const entryTitle = (entry.meta.title.trim() || parsedEntry.title || '').trim()
        if (entryTitle === '') throw new Error(`${prefix}标题为空，先填标题再发布`)
        const entryAuthor = entry.meta.author.trim()
        const entryDigest = entry.meta.digest.trim() || deriveDigest(parsedEntry.blocks)
        const measureText = text.replace(/data:image\/[a-zA-Z+]+;base64,[^)\s]+/g, '')
        const readingMinutes = measure(parsedEntry.blocks, measureText).readingMinutes
        const tree = buildArticle({
          blocks: parsedEntry.blocks,
          design: designEntry,
          meta: { title: entryTitle, author: entryAuthor, date: formatDate(entry.updatedAt), readingMinutes },
        })

        const dataImages = collectDataImages(tree.nodes)
        if (dataImages.length > 0) {
          push(`${prefix}压缩并上传正文图片（${dataImages.length} 张）`, 'running')
          const preparedImages = []
          const originalById = new Map()
          for (let imageIndex = 0; imageIndex < dataImages.length; imageIndex += 1) {
            const original = dataImages[imageIndex]
            const id = `img-${index}-${imageIndex}`
            const compressed = await compressImage(original)
            preparedImages.push({ id, dataUrl: compressed.dataUrl, name: `image-${imageIndex}.jpg` })
            originalById.set(id, original)
          }
          const value = await callHost('uploadImages', { images: preparedImages }, { timeoutMs: 180000 })
          const mapping = new Map()
          for (const image of value.images ?? []) {
            const original = originalById.get(image.id)
            if (original && image.url) mapping.set(original, image.url)
          }
          rewriteImageSources(tree.nodes, mapping)
          markLastDone()
        }

        const remoteImages = collectRemoteImages(tree.nodes)
        if (remoteImages.length > 0) {
          push(`${prefix}转存外链图片（${remoteImages.length} 张）`, 'running')
          const value = await callHost('importImages', { urls: remoteImages }, { timeoutMs: 180000 })
          const mapping = new Map()
          for (const image of value.images ?? []) {
            if (image.url && image.wechatUrl) mapping.set(image.url, image.wechatUrl)
          }
          rewriteImageSources(tree.nodes, mapping)
          markLastDone()
        }

        const html = serializeNodes(tree.nodes)
        if (html.length > 950 * 1024) throw new Error(`${prefix}正文 HTML 超过 950KB，删掉几张图或缩短正文后再试`)
        push(`${prefix}生成内联样式正文`, 'done', `${Math.round(html.length / 1024)}KB`)

        push(`${prefix}上传封面到素材库`, 'running')
        const cover = entry.meta.coverCustom === true && typeof entry.meta.coverDataUrl === 'string' && entry.meta.coverDataUrl !== ''
          ? entry.meta.coverDataUrl
          : renderCover({ title: entryTitle, design: designEntry })
        const coverValue = await callHost('uploadCover', { dataUrl: cover, name: 'cover.png' }, { timeoutMs: 120000 })
        markLastDone()

        preparedArticles.push({
          title: entryTitle,
          author: entryAuthor === '' ? undefined : entryAuthor,
          digest: entryDigest,
          content: html,
          thumbMediaId: coverValue.mediaId,
          contentSourceUrl: entry.meta.sourceUrl.trim() || undefined,
          needOpenComment: entry.meta.needOpenComment === true,
          onlyFansCanComment: entry.meta.needOpenComment === true && entry.meta.onlyFansCanComment === true,
        })
      }

      if (mode === 'update') {
        if (savedMediaId === '') throw new Error(t('当前草稿还没有关联公众号草稿，请先另存为新草稿'))
        if (savedArticleCount > 0 && savedArticleCount !== preparedArticles.length) {
          throw new Error(t('合集篇数从 {old} 篇变成 {next} 篇，无法覆盖更新；请另存为新草稿', { old: savedArticleCount, next: preparedArticles.length }))
        }
        push(t('更新公众号草稿'), 'running')
        try {
          const updated = await callHost('updateDraft', { mediaId: savedMediaId, articles: preparedArticles }, { timeoutMs: 120000 })
          const warnings = Array.isArray(updated.warnings) ? updated.warnings : []
          setSteps(list => list.map((step, index) => (index === list.length - 1 ? { ...step, state: 'done', detail: warnings.join('；') || updated.mediaId } : step)))
          setResult({ kind: 'draft', mediaId: updated.mediaId, warnings, count: preparedArticles.length, updated: true })
          store.updateMeta({ draftArticleCount: preparedArticles.length })
          await recordLedger('updated', { mediaId: updated.mediaId, count: preparedArticles.length })
          toast(t('已更新公众号草稿'), 'success')
        } catch (failure) {
          if (failure?.code === 'invalid-media') {
            store.updateMeta({ draftMediaId: '', draftArticleCount: 0 })
            throw new Error(t('关联的公众号草稿已失效，已解除关联；请点「保存到草稿箱」重新建立。'))
          }
          throw failure
        }
        return
      }
      push(`写入公众号草稿箱${preparedArticles.length > 1 ? `（${preparedArticles.length} 篇）` : ''}`, 'running')
      const draft = await callHost('createDraft', { articles: preparedArticles }, { timeoutMs: 120000 })
      const warnings = Array.isArray(draft.warnings) ? draft.warnings : []
      setSteps(list => list.map((step, index) => (index === list.length - 1 ? { ...step, state: 'done', detail: warnings.join('；') || draft.mediaId } : step)))
      if (typeof draft.mediaId === 'string') {
        store.updateMeta({ draftMediaId: draft.mediaId, draftArticleCount: preparedArticles.length })
        await recordLedger('draft', { mediaId: draft.mediaId, count: preparedArticles.length })
      }
      setResult({ kind: 'draft', mediaId: draft.mediaId, warnings, count: preparedArticles.length, updated: false })

      if (mode === 'publish') {
        push(t('提交发布'), 'running')
        const published = await callHost('publish', { mediaId: draft.mediaId }, { timeoutMs: 120000 })
        setSteps(list => list.map((step, index) => (index === list.length - 1 ? { ...step, state: 'done', detail: published.publishId } : step)))
        let status = null
        try {
          for (let attempt = 0; attempt < 6; attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 2500))
            status = await callHost('publishStatus', { publishId: published.publishId })
            if (status.publishStatus !== 1) break
          }
        } catch {
          status = { publishStatus: -1, statusText: t('状态查询失败，发布可能仍在继续，稍后到公众号后台确认') }
        }
        setResult({ kind: 'published', mediaId: draft.mediaId, publishId: published.publishId, status, count: preparedArticles.length })
        push(
          t('发布结果'),
          status?.publishStatus === 0 || status?.publishStatus === 1 ? 'done' : status?.publishStatus === -1 ? 'running' : 'error',
          status?.statusText ?? t('状态未知'),
        )
      }
      toast(mode === 'publish' ? t('已提交发布，结果见下方状态') : t('已保存到公众号草稿箱'), 'success')
    } catch (failure) {
      setError({ message: failure.message || t('发布失败'), code: failure.code })
      toast(failure.message || t('发布失败'), 'error')
      setSteps(list => list.map((step, index) => (index === list.length - 1 && step.state === 'running' ? { ...step, state: 'error' } : step)))
    } finally {
      setBusy(false)
    }
  }

  return h('div', { className: 'ws-sections' },
    h('div', { className: 'ws-card' },
      h('div', { className: 'ws-card-head' },
        h(Icon, { name: 'key', size: 14 }),
        h('span', null, t('公众号配置')),
        h('span', { className: 'ws-badge ' + (hostStatus.configured ? 'ok' : '') }, hostStatus.configured ? t('已连接') : hostStatus.phase === 'error' ? t('服务未响应') : t('未配置')),
      ),
      hostStatus.phase === 'error'
        ? h('p', { className: 'ws-hint danger' }, hostStatus.message)
        : null,
      hostStatus.configured
        ? h('p', { className: 'ws-hint' }, `AppID：${hostStatus.appIdPreview ?? t('（已保存）')}。密钥只在本机凭据库，页面拿不到明文。`)
        : h('p', { className: 'ws-hint' }, t('在公众号后台「设置与开发 → 基本配置」拿到 AppID 与 AppSecret。还需要把本机出口 IP 加进白名单。')),
      accounts.items.length > 0
        ? h('div', { className: 'ws-accounts' },
          accounts.items.map(item => h('div', { key: item.id, className: 'ws-account-row' + (item.active ? ' on' : '') },
            h('span', { className: 'ws-account-name' }, item.name),
            h('span', { className: 'ws-account-id' }, item.appIdPreview),
            item.active
              ? h('span', { className: 'ws-badge ok' }, t('当前'))
              : h('button', { type: 'button', className: 'ws-link', disabled: configBusy, onClick: () => switchAccount(item.id) }, t('切换')),
            accounts.items.length > 1 && !item.active
              ? h('button', { type: 'button', className: 'ws-link danger', disabled: configBusy, onClick: () => removeAccount(item.id) }, t('删除'))
              : null,
          )),
        )
        : null,
      configOpen
        ? h('div', { className: 'ws-config' },
          h('label', { className: 'ws-field' }, h('span', { className: 'ws-field-label' }, t('账号名称')), h('input', { className: 'ws-input', value: accountName, placeholder: t('例如：品牌主号'), onChange: event => setAccountName(event.target.value) })),
          h('label', { className: 'ws-field' }, h('span', { className: 'ws-field-label' }, 'AppID'), h('input', { className: 'ws-input', value: appId, placeholder: t('wx 开头的一串字符'), onChange: event => setAppId(event.target.value) })),
          h('label', { className: 'ws-field' }, h('span', { className: 'ws-field-label' }, 'AppSecret'), h('input', { className: 'ws-input', type: 'password', value: appSecret, placeholder: t('32 位密钥，保存后不再显示'), onChange: event => setAppSecret(event.target.value) })),
          h('div', { className: 'ws-row' },
            h(Button, { variant: 'primary', disabled: configBusy || appId.trim() === '' || appSecret.trim() === '', onClick: saveConfig }, configBusy ? t('保存中…') : t('保存')),
            h(Button, { onClick: () => setConfigOpen(false) }, t('取消')),
          ),
        )
        : h('div', { className: 'ws-row' },
          h(Button, { variant: hostStatus.configured ? 'ghost' : 'primary', onClick: () => { setConfigOpen(true); setAccountName(''); setAppId(''); setAppSecret('') }, disabled: hostStatus.phase === 'error' }, hostStatus.configured ? t('新增账号') : t('填写密钥')),
          hostStatus.configured ? h(Button, { onClick: testConnection, disabled: configBusy }, configBusy ? t('测试中…') : t('测试连接')) : null,
          hostStatus.configured ? h(Button, { onClick: clearConfig, disabled: configBusy, variant: 'ghost' }, t('清除全部')) : null,
        ),
    ),
    h('div', { className: 'ws-card' },
      h('div', { className: 'ws-card-head' },
        h(Icon, { name: 'send', size: 14 }),
        h('span', null, t('网络与出口')),
        h('span', { className: 'ws-badge ' + (networkState.mode === 'proxy' ? 'ok' : '') }, networkState.mode === 'proxy' ? t('固定代理') : t('跟随系统')),
      ),
      h('p', { className: 'ws-hint' }, t('先获取出口 IP，加到公众号白名单，再测试连接。')),
      networkState.phase === 'error' ? h('p', { className: 'ws-hint danger' }, networkState.error) : null,
      h('div', { className: 'ws-egress-row' },
        h('span', { className: 'ws-egress-label' }, t('出口 IP')),
        h('strong', { className: 'ws-egress-ip' }, egress?.ip ?? t('未检测')),
        h(Button, { disabled: networkBusy, onClick: probeNetworkEgress }, networkBusy ? t('检测中…') : (egress === null ? t('获取出口 IP') : t('重新检测'))),
        egress !== null ? h(Button, { onClick: copyEgressIp }, t('复制 IP')) : null,
        egress !== null ? h(Button, { disabled: configBusy, onClick: testConnection }, configBusy ? t('测试中…') : t('测试微信连接')) : null,
      ),
      h('p', { className: 'ws-hint' }, t('把出口 IP 加到公众号后台 → 设置与开发 → 基本配置 → IP白名单，然后点「测试微信连接」。')),
      h('div', { className: 'ws-row' },
        h(Button, { disabled: wechatBusy || !hostStatus.configured, onClick: probeWechatEgress }, wechatBusy ? t('检测中…') : t('检测微信出口')),
        wechatProbe !== null && Array.isArray(wechatProbe.ips) && wechatProbe.ips.length === 1 ? h(Button, { onClick: copyWechatIp }, t('复制微信 IP')) : null,
      ),
      wechatProbe !== null && Array.isArray(wechatProbe.ips) && wechatProbe.ips.length > 0
        ? h('p', { className: 'ws-hint' }, `${t('微信看到的出口 IP')}：${wechatProbe.ips.join(' / ')}`)
        : null,
      wechatProbe !== null && wechatProbe.changing === true
        ? h('p', { className: 'ws-hint danger' }, t('微信出口 IP 在变化，白名单会一直失效。先把代理固定到一个出口，或在 Shadowrocket 里给微信域名指定固定节点。'))
        : null,
      wechatProbe !== null && egress !== null && Array.isArray(wechatProbe.ips) && wechatProbe.ips.length > 0 && wechatProbe.ips[0] !== egress.ip
        ? h('p', { className: 'ws-hint danger' }, t('微信走的出口和普通流量不同：微信是 {wechat}，普通流量是 {general}。IP 白名单必须填微信那个。', { wechat: wechatProbe.ips[0], general: egress.ip }))
        : null,
      wechatProbe !== null && wechatProbe.whitelisted === true
        ? h('p', { className: 'ws-hint' }, t('微信接口已能正常调用，当前出口已在白名单。'))
        : null,
      h('button', {
        type: 'button',
        className: 'ws-link',
        onClick: () => setNetworkAdvanced(value => !value),
      }, networkAdvanced ? t('收起高级设置') : t('网络高级设置（自定义代理）')),
      networkAdvanced
        ? h('div', { className: 'ws-advanced' },
          h('div', { className: 'ws-device-switch' },
            [['system', t('跟随系统')], ['proxy', t('自定义代理')]].map(([value, label]) => h('button', {
              key: value,
              type: 'button',
              className: 'ws-device-btn' + (networkMode === value ? ' on' : ''),
              onClick: () => setNetworkMode(value),
            }, label)),
          ),
          networkMode === 'proxy'
            ? h('label', { className: 'ws-field' },
              h('span', { className: 'ws-field-label' }, t('代理地址')),
              h('input', {
                className: 'ws-input',
                value: networkProxy,
                placeholder: networkState.proxyUrl || 'http://127.0.0.1:7890',
                onChange: event => setNetworkProxy(event.target.value),
                spellCheck: false,
              }),
            )
            : null,
          h('div', { className: 'ws-row' },
            h(Button, { variant: 'primary', disabled: networkBusy, onClick: saveNetworkSettings }, networkBusy ? t('保存中…') : t('保存代理设置')),
          ),
          networkState.mode === 'proxy' && networkState.proxyUrl !== ''
            ? h('p', { className: 'ws-hint' }, `${t('当前代理')}：${networkState.proxyUrl}`)
            : null,
          h('p', { className: 'ws-hint' }, t('代理只作用于微信接口请求，地址存在本机凭据库，密码不会回传页面。')),
        )
        : null,
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('文章信息')), h('span', { className: 'ws-group-note' }, `标题 ${title.length}/64 · 摘要 ${digest.length}/120`)),
      h('label', { className: 'ws-field' }, h('span', { className: 'ws-field-label' }, t('标题')), h('input', { className: 'ws-input', value: doc.meta.title, placeholder: title || t('文章标题'), maxLength: 64, onChange: event => store.updateMeta({ title: event.target.value }) })),
      h('label', { className: 'ws-field' }, h('span', { className: 'ws-field-label' }, t('公众号名称')), h('input', { className: 'ws-input', value: doc.meta.brand ?? '', placeholder: t('预览顶栏显示；留空显示“公众号”'), maxLength: 30, onChange: event => store.updateMeta({ brand: event.target.value }) })),
      h('label', { className: 'ws-field' }, h('span', { className: 'ws-field-label' }, t('作者')), h('input', { className: 'ws-input', value: doc.meta.author, placeholder: t('留空则用公众号主体名'), maxLength: 8, onChange: event => store.updateMeta({ author: event.target.value }) })),
      h('label', { className: 'ws-field' }, h('span', { className: 'ws-field-label' }, t('摘要')), h('textarea', { className: 'ws-input ws-textarea', rows: 2, value: doc.meta.digest, placeholder: digest || t('留空自动取首段'), maxLength: 120, onChange: event => store.updateMeta({ digest: event.target.value }) })),
      h('label', { className: 'ws-field' }, h('span', { className: 'ws-field-label' }, t('原文链接')), h('input', { className: 'ws-input', value: doc.meta.sourceUrl, placeholder: t('可选，https://'), onChange: event => store.updateMeta({ sourceUrl: event.target.value }) })),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('发布选项'))),
      h(Toggle, {
        label: t('允许读者评论'),
        checked: doc.meta.needOpenComment === true,
        onChange: value => store.updateMeta(value ? { needOpenComment: true } : { needOpenComment: false, onlyFansCanComment: false }),
      }),
      doc.meta.needOpenComment === true
        ? h(Toggle, {
          label: t('仅关注者可评论'),
          checked: doc.meta.onlyFansCanComment === true,
          onChange: value => store.updateMeta({ onlyFansCanComment: value }),
        })
        : null,
      h('p', { className: 'ws-hint' }, t('评论设置会写进草稿；公众号后台仍可再改。')),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' },
        h('span', null, t('合集（可选）')),
        h('span', { className: 'ws-group-note' }, `${Math.min(8, bundleIds.length + 1)}/8 篇`),
      ),
      (() => {
        const candidates = store.docs.filter(entry => entry.id !== doc.id)
        if (candidates.length === 0) return h('p', { className: 'ws-hint' }, t('只有当前草稿。新建几篇本地草稿后，可以把它们一起保存成多图文草稿。'))
        return [
          h('p', { className: 'ws-hint' }, t('把其他本地草稿加入，一起保存成公众号多图文草稿（最多 8 篇，含当前这篇）。')),
          ...candidates.map((entry) => {
            const checked = bundleIds.includes(entry.id)
            const heading = (entry.text.match(/^#\s+(.+)$/m) ?? [])[1] ?? ''
            const label = entry.meta.title.trim() || heading || t('未命名草稿')
            return h('button', {
              key: entry.id,
              type: 'button',
              className: 'ws-bundle-row' + (checked ? ' on' : ''),
              onClick: () => setBundleIds(list => (list.includes(entry.id) ? list.filter(id => id !== entry.id) : (list.length >= 7 ? list : [...list, entry.id]))),
            }, h('span', { className: 'ws-bundle-check' }, checked ? '✓' : ''), h('span', { className: 'ws-bundle-title' }, label))
          }),
        ]
      })(),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('封面（2.35:1）')), h('span', { className: 'ws-group-note' }, doc.meta.coverCustom === true ? t('当前是自定义封面') : t('自动按主题生成'))),
      coverDataUrl !== ''
        ? h('img', { className: 'ws-cover', src: coverDataUrl, alt: t('封面预览') })
        : h('div', { className: 'ws-cover ws-cover-empty' }, t('封面生成中…')),
      h('div', { className: 'ws-chips ws-cover-layouts' },
        [['left', t('左对齐')], ['center', t('居中')], ['bottom', t('底部')], ['minimal', t('极简')]].map(([value, label]) => h('button', {
          key: value,
          type: 'button',
          className: 'ws-chip' + (doc.meta.coverCustom !== true && coverLayout === value ? ' on' : ''),
          onClick: () => store.updateMeta({ coverLayout: value, coverCustom: false }),
        }, label)),
      ),
      h('div', { className: 'ws-row' },
        h(Button, { onClick: regenerateCover, disabled: coverBusy }, t('按主题重绘')),
        h(Button, { onClick: () => coverInputRef.current?.click(), disabled: coverBusy }, coverBusy ? t('处理中…') : t('上传图片')),
        h('input', { ref: coverInputRef, type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: uploadCoverFile }),
      ),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('发布计划'))),
      h('div', { className: 'ws-field-row' },
        h('span', { className: 'ws-field-label' }, t('计划日期')),
        h('input', {
          className: 'ws-input',
          type: 'date',
          value: typeof doc.meta.plannedAt === 'string' ? doc.meta.plannedAt.slice(0, 10) : '',
          onChange: event => store.updateMeta({ plannedAt: event.target.value === '' ? '' : `${event.target.value}T09:00:00` }),
        }),
      ),
      store.docs.filter(entry => typeof entry.meta.plannedAt === 'string' && entry.meta.plannedAt !== '').slice(0, 6).map(entry => h('div', { key: entry.id, className: 'ws-plan-row' + (entry.id === doc.id ? ' on' : '') },
        h('span', { className: 'ws-plan-date' }, entry.meta.plannedAt.slice(0, 10)),
        h('span', { className: 'ws-plan-title' }, entry.meta.title.trim() || parseArticle(entry.text).title || t('未命名草稿')),
        entry.id === doc.id ? h('span', { className: 'ws-badge' }, t('当前')) : h('button', { type: 'button', className: 'ws-link', onClick: () => store.selectDoc(entry.id) }, t('打开')),
      )),
      h('p', { className: 'ws-hint' }, t('计划日期只是本地排期，不会自动发布；到时间在发布面板手动发送。')),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' },
        h('span', null, t('发布复盘')),
        h('button', { type: 'button', className: 'ws-link', disabled: statsBusy || hostStatus.configured !== true, onClick: loadArticleStats }, statsBusy ? t('读取中…') : t('读取近 7 天')),
      ),
      stats.phase === 'error' ? h('p', { className: 'ws-hint ws-error-text' }, stats.error) : null,
      stats.phase === 'ready' && stats.items.length === 0 ? h('p', { className: 'ws-hint' }, t('近 {days} 天没有读到发布数据；公众号可能还没有数据统计权限。', { days: stats.days })) : null,
      stats.items.slice(0, 6).map((item, index) => h('div', { key: `${item.ref_date ?? index}-${item.title ?? index}`, className: 'ws-stat-row' },
        h('span', { className: 'ws-stat-title' }, item.title ?? t('未命名文章')),
        h('span', { className: 'ws-stat-num' }, `${t('阅读')} ${item.read_num ?? item.readNum ?? 0}`),
        h('span', { className: 'ws-stat-num' }, `${t('分享')} ${item.share_num ?? item.shareNum ?? 0}`),
      )),
      h('p', { className: 'ws-hint' }, t('需要公众号的数据统计权限；没有权限时只显示发布对账单。')),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' },
        h('span', null, t('发布对账单')),
        h('span', { className: 'ws-group-note' }, ledger.length === 0 ? t('还没有发布记录') : t('最近 {count} 条', { count: ledger.length })),
      ),
      ledger.length === 0
        ? h('p', { className: 'ws-hint' }, t('保存草稿或发布后，这里会记录每一版与当前正文的差异。'))
        : (() => {
          const latest = ledger[0]
          const drift = latest.text === '' ? null : diffTextLines(doc.text, latest.text)
          const added = drift === null ? 0 : drift.filter(item => item.type === 'add').length
          const removed = drift === null ? 0 : drift.filter(item => item.type === 'remove').length
          const currentTheme = `${design.themeName} · ${design.variantName}`
          return h('div', { className: 'ws-ledger' },
            h('div', { className: 'ws-ledger-summary' },
              h('strong', null, t('当前与「{type}」的差异', { type: ledgerLabel(latest.type) })),
              h('span', null, t('新增 {added} 行 · 删除 {removed} 行', { added, removed })),
              latest.theme !== '' && latest.theme !== currentTheme ? h('span', null, t('主题已从 {old} 改为 {now}', { old: latest.theme, now: currentTheme })) : null,
            ),
            ledger.map(event => h(React.Fragment, { key: event.id },
              h('div', { className: 'ws-ledger-row' },
                h('span', { className: 'ws-ledger-time' }, new Date(event.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })),
                h('span', { className: 'ws-ledger-type' }, ledgerLabel(event.type)),
                h('span', { className: 'ws-ledger-media' }, event.mediaId === '' ? event.publishId.slice(-8) : event.mediaId.slice(-8)),
                h('button', { type: 'button', className: 'ws-link', onClick: () => setCompareLedger(value => value?.id === event.id ? null : event) }, t('对比')),
                h('button', { type: 'button', className: 'ws-link', onClick: () => restoreLedger(event) }, t('恢复')),
              ),
              compareLedger?.id === event.id
                ? h('div', { className: 'ws-snapshot-diff' },
                  h('div', { className: 'ws-diff-lines' },
                    diffTextLines(doc.text, event.text).filter(item => item.type !== 'same').slice(0, 24).map((item, index) => h('div', {
                      key: index,
                      className: 'ws-diff-line ' + item.type,
                    }, `${item.type === 'add' ? '+' : '-'} ${item.text.length > 90 ? `${item.text.slice(0, 90)}…` : item.text || ' '}`)),
                  ),
                )
                : null,
            )),
          )
        })(),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' },
        h('span', null, t('历史版本')),
        h('button', { type: 'button', className: 'ws-link', disabled: snapshotBusy, onClick: saveManualSnapshot }, snapshotBusy ? t('保存中…') : t('保存快照')),
      ),
      snapshots.length === 0
        ? h('p', { className: 'ws-hint' }, t('暂无历史版本；AI 修改前和发布前会自动保存快照。'))
        : h('div', { className: 'ws-snapshot-list' },
          snapshots.map(snapshot => {
            const reason = snapshot.reason === 'before-ai' ? t('AI 修改前') : snapshot.reason === 'before-publish' ? t('发布前') : snapshot.reason === 'before-restore' ? t('恢复前') : t('手动')
            return h(React.Fragment, { key: snapshot.id },
              h('div', { className: 'ws-snapshot-row' },
                h('span', { className: 'ws-snapshot-time' }, new Date(snapshot.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })),
                h('span', { className: 'ws-snapshot-reason' }, reason),
                h('span', { className: 'ws-snapshot-chars' }, `${snapshot.text.length} ${t('字')}`),
                h('button', { type: 'button', className: 'ws-link', onClick: () => setCompareSnapshot(value => value?.id === snapshot.id ? null : snapshot) }, t('对比')),
                h('button', { type: 'button', className: 'ws-link', onClick: () => restoreSnapshot(snapshot) }, t('恢复')),
              ),
              compareSnapshot?.id === snapshot.id
                ? h('div', { className: 'ws-snapshot-diff' },
                  h('p', { className: 'ws-hint' }, t('当前正文 → 快照；绿色为快照新增，红色为当前有而快照没有。')),
                  h('div', { className: 'ws-diff-lines' },
                    diffTextLines(doc.text, snapshot.text).filter(item => item.type !== 'same').slice(0, 24).map((item, index) => h('div', {
                      key: index,
                      className: 'ws-diff-line ' + item.type,
                    }, `${item.type === 'add' ? '+' : '-'} ${item.text.length > 90 ? `${item.text.slice(0, 90)}…` : item.text || ' '}`)),
                  ),
                )
                : null,
            )
          }),
        ),
      h('p', { className: 'ws-hint' }, t('快照存在浏览器 IndexedDB，最多保留最近 20 个版本。')),
    ),
    h('div', { className: 'ws-card ws-qa' },
      h('div', { className: 'ws-card-head' },
        h('span', null, t('发布前质检')),
        h('span', { className: 'ws-badge ' + qa.status }, qa.status === 'blocked' ? t('先别发') : qa.status === 'review' ? t('建议改 {count} 处', { count: qa.issues }) : t('可以发')),
      ),
      h('div', { className: 'ws-qa-grid' },
        h('div', { className: 'ws-qa-item' },
          h('span', { className: 'ws-qa-label' }, t('实测保真')),
          h('strong', null, fidelityFor(doc.design.themeId) === null ? t('未实测') : `${fidelityFor(doc.design.themeId).score}/100`),
        ),
        h('div', { className: 'ws-qa-item' },
          h('span', { className: 'ws-qa-label' }, t('AI 改写 / 锁定')),
          h('strong', null, `${qa.aiCount} / ${qa.lockedCount}`),
        ),
        h('div', { className: 'ws-qa-item' },
          h('span', { className: 'ws-qa-label' }, t('规范违规')),
          h('strong', null, houseStyle.violations),
        ),
        h('div', { className: 'ws-qa-item' },
          h('span', { className: 'ws-qa-label' }, t('分发提示')),
          h('strong', null, qa.distributionCount),
        ),
        h('div', { className: 'ws-qa-item' },
          h('span', { className: 'ws-qa-label' }, t('发布检查')),
          h('strong', null, `${qa.errors} ${t('错误')} · ${qa.warnings} ${t('提醒')}`),
        ),
      ),
      qa.issues > 0
        ? h('div', { className: 'ws-qa-issues' }, preflight.filter(item => item.level !== 'ok').slice(0, 4).map((item, index) => h('span', { key: index, className: 'ws-qa-issue ' + item.level }, item.label)))
        : h('p', { className: 'ws-hint' }, t('没有发现会阻断发布的问题。')),
      h('p', { className: 'ws-hint' }, t('质检汇总发布检查、实测保真、AI 来源、段落锁与分发场景；下面的细节仍可逐条查看。')),
    ),
    h('div', { className: 'ws-card ws-preflight' },
      h('div', { className: 'ws-card-head' },
        h(Icon, { name: 'check', size: 14 }),
        h('span', null, t('发布检查')),
        h('span', { className: 'ws-badge ' + (preflight.some(item => item.level === 'error') ? 'danger' : preflight.some(item => item.level === 'warn') ? '' : 'ok') },
          preflight.some(item => item.level === 'error')
            ? t('{count} 个问题', { count: preflight.filter(item => item.level === 'error').length })
            : preflight.some(item => item.level === 'warn')
              ? t('{count} 项提醒', { count: preflight.filter(item => item.level === 'warn').length })
              : t('可以发布')),
      ),
      h('div', { className: 'ws-preflight-list' },
        preflight.map((item, index) => h('div', { key: `${item.label}-${index}`, className: 'ws-preflight-row ' + item.level },
          h('span', { className: 'ws-preflight-dot' }),
          h('span', { className: 'ws-preflight-label' }, item.label),
          item.detail !== '' ? h('span', { className: 'ws-preflight-detail' }, item.detail) : null,
        )),
      ),
    ),
    h('div', { className: 'ws-publish-actions' },
      savedMediaId !== ''
        ? h(Button, { icon: 'save', variant: 'primary', disabled: busy || hostStatus.phase === 'error', onClick: () => runPublish('update') }, busy ? t('处理中…') : t('更新当前草稿'))
        : h(Button, { icon: 'save', variant: 'primary', disabled: busy || hostStatus.phase === 'error', onClick: () => runPublish('draft') }, busy ? t('处理中…') : t('保存到草稿箱')),
      savedMediaId !== ''
        ? h(Button, { disabled: busy || hostStatus.phase === 'error', onClick: () => runPublish('draft') }, t('另存新草稿'))
        : null,
      confirmPublish
        ? h('div', { className: 'ws-confirm' },
          h('span', null, t('直接发布会占用当天发布次数，确认？')),
          h(Button, { variant: 'danger', onClick: () => runPublish('publish'), disabled: busy }, t('确认发布')),
          h(Button, { variant: 'ghost', onClick: () => setConfirmPublish(false) }, t('再想想')),
        )
        : h(Button, { icon: 'send', variant: 'solid', disabled: busy || hostStatus.phase === 'error', onClick: () => setConfirmPublish(true) }, t('直接发布')),
    ),
    savedMediaId !== ''
      ? h('p', { className: 'ws-hint' }, savedArticleCount > 0 ? t('已关联公众号草稿（{count} 篇）；更新会覆盖后台对应文章。', { count: savedArticleCount }) : t('这篇已关联公众号草稿；更新会覆盖后台那一篇。'))
      : null,
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' },
        h('span', null, t('公众号草稿箱')),
        h('button', { type: 'button', className: 'ws-link', onClick: () => loadDrafts(draftBox.offset), disabled: draftBusy || hostStatus.configured !== true }, draftBusy ? t('读取中…') : t('刷新草稿箱')),
      ),
      h('input', {
        className: 'ws-input ws-draft-search',
        value: draftQuery,
        placeholder: t('在已加载的草稿里搜索标题'),
        onChange: event => setDraftQuery(event.target.value),
      }),
      draftBox.phase === 'error' ? h('p', { className: 'ws-hint ws-error-text' }, draftBox.error) : null,
      draftBox.phase === 'ready' && draftBox.items.length === 0 ? h('p', { className: 'ws-hint' }, t('草稿箱是空的。')) : null,
      draftBox.phase === 'ready' && draftBox.items.length > 0 && draftBox.items.filter(item => item.title.toLowerCase().includes(draftQuery.trim().toLowerCase())).length === 0
        ? h('p', { className: 'ws-hint' }, t('当前页没有匹配标题。'))
        : null,
      draftBox.items.filter(item => draftQuery.trim() === '' || item.title.toLowerCase().includes(draftQuery.trim().toLowerCase())).map(item => h('div', { key: item.mediaId, className: 'ws-draft-row' },
        h('div', { className: 'ws-draft-main' },
          h('span', { className: 'ws-draft-title' }, item.title === '' ? t('（无标题）') : item.title),
          h('span', { className: 'ws-draft-meta' }, item.updateTime > 0 ? new Date(item.updateTime * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : t('时间未知')),
        ),
        h('div', { className: 'ws-draft-actions' },
          h('button', { type: 'button', className: 'ws-link', disabled: importingDraft === item.mediaId, onClick: () => importDraft(item) }, importingDraft === item.mediaId ? t('导入中…') : t('导入')),
          h('button', { type: 'button', className: 'ws-link danger', onClick: () => removeDraft(item.mediaId) }, deleteArm === item.mediaId ? t('确认删除') : t('删除')),
        ),
      )),
      draftBox.phase === 'ready' && draftBox.total > 0
        ? h('div', { className: 'ws-draft-pager' },
          h('button', { type: 'button', className: 'ws-link', disabled: draftBusy || draftBox.offset <= 0, onClick: () => loadDrafts(Math.max(0, draftBox.offset - 10)) }, t('上一页')),
          h('span', { className: 'ws-hint' }, t('{from}–{to} / 共 {total} 篇', {
            from: draftBox.offset + 1,
            to: Math.min(draftBox.offset + 10, draftBox.total),
            total: draftBox.total,
          })),
          h('button', { type: 'button', className: 'ws-link', disabled: draftBusy || draftBox.offset + 10 >= draftBox.total, onClick: () => loadDrafts(draftBox.offset + 10) }, t('下一页')),
        )
        : null,
      h('p', { className: 'ws-hint' }, t('删除会直接移除公众号后台的草稿，不影响已发布的文章。')),
    ),
    steps.length > 0
      ? h('div', { className: 'ws-steps' }, steps.map((step, index) => h('div', { key: index, className: 'ws-step ' + step.state },
        h('span', { className: 'ws-step-dot' }),
        h('span', { className: 'ws-step-label' }, step.label),
        step.detail ? h('span', { className: 'ws-step-detail' }, step.detail) : null,
      )))
      : null,
    error
      ? h('div', { className: 'ws-error' },
        h('strong', null, error.message),
        error.code === 'ip-not-allowed' ? h('p', null, t('打开公众号后台 → 设置与开发 → 基本配置 → IP白名单，加入提示里的 IP 后重试。')) : null,
        error.code === 'api-unauthorized' ? h('p', null, t('未认证的订阅号通常没有发布接口，改用「保存到草稿箱」或「复制 HTML」。')) : null,
        error.code === 'not-configured' ? h('p', null, t('先在上方填写 AppID 和 AppSecret。')) : null,
      )
      : null,
    result
      ? h('div', { className: 'ws-result' },
        h('strong', null, result.kind === 'published' ? t('已提交发布') : t('已进入草稿箱')),
        result.kind === 'draft' ? h('p', null, result.count > 1 ? t('已写入 {count} 篇多图文草稿，到公众号后台「内容管理 → 草稿箱」查看。', { count: result.count }) : t('到公众号后台「内容管理 → 草稿箱」就能看到这篇，手机预览后手动发布。')) : null,
        result.kind === 'published'
          ? h('p', null, t('发布状态：{status}', { status: result.status?.statusText ?? t('发布中，稍后可在后台查看') }))
          : null,
        result.warnings && result.warnings.length > 0 ? h('p', null, t('提示：{warnings}', { warnings: result.warnings.join('；') })) : null,
        h('a', { className: 'ws-link', href: 'https://mp.weixin.qq.com/', target: '_blank', rel: 'noreferrer' }, t('打开公众号后台')),
      )
      : null,
  )
}

function deriveDigest(blocks) {
  const first = blocks.find(block => block.type === 'paragraph')
  if (!first) return ''
  const plain = plainText(first.text).replace(/\s+/g, ' ').trim()
  return plain.length > 110 ? `${plain.slice(0, 110)}…` : plain
}

function collectRemoteImages(nodes) {
  const found = []
  const walk = list => {
    for (const current of list) {
      if (typeof current === 'string' || !current) continue
      if (current.tag === 'img') {
        const src = current.attrs?.src
        if (typeof src === 'string' && /^https?:\/\//i.test(src) && !/(mmbiz\.qpic\.cn|mmbiz\.qlogo\.cn|wx\.qlogo\.cn)/i.test(src)) {
          if (!found.includes(src)) found.push(src)
        }
      }
      walk(current.children ?? [])
    }
  }
  walk(nodes)
  return found
}

/* Cover generation ------------------------------------------------- */

function wrapCoverTitle(context, title, maxWidth) {
  const lines = []
  let line = ''
  for (const character of title) {
    const candidate = line + character
    if (context.measureText(candidate).width > maxWidth && line !== '') {
      lines.push(line)
      line = character
    } else {
      line = candidate
    }
    if (lines.length === 3) break
  }
  if (lines.length < 3 && line !== '') lines.push(line)
  if (lines.length === 3 && lines.join('').length < title.length) lines[2] = `${lines[2].slice(0, Math.max(1, lines[2].length - 1))}…`
  return lines
}

function renderCover({ title, design, layout = 'left' }) {
  const canvas = document.createElement('canvas')
  canvas.width = 900
  canvas.height = 383
  const context = canvas.getContext('2d')
  if (context === null) throw new Error(t('当前环境无法生成封面'))
  const accent = design.colors.accent
  const ink = design.colors.accentInk
  const out = ['left', 'center', 'bottom', 'minimal'].includes(layout) ? layout : 'left'
  if (out === 'minimal') {
    context.fillStyle = mixHex(accent, '#000000', 0.12)
    context.fillRect(0, 0, 900, 383)
  } else {
    const gradient = context.createLinearGradient(0, 0, 900, 383)
    gradient.addColorStop(0, mixHex(accent, '#000000', 0.05))
    gradient.addColorStop(0.55, accent)
    gradient.addColorStop(1, mixHex(accent, '#000000', 0.42))
    context.fillStyle = gradient
    context.fillRect(0, 0, 900, 383)
  }

  if (out !== 'minimal') {
    context.globalAlpha = 0.08
    context.fillStyle = ink
    context.beginPath()
    context.arc(760, 90, 150, 0, Math.PI * 2)
    context.fill()
    context.beginPath()
    context.arc(845, 330, 110, 0, Math.PI * 2)
    context.fill()
    context.globalAlpha = 1
  }

  const x = out === 'center' ? 450 : 64
  context.textAlign = out === 'center' ? 'center' : 'left'
  if (out !== 'minimal') {
    context.strokeStyle = ink
    context.globalAlpha = 0.35
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(out === 'center' ? 428 : 64, 118)
    context.lineTo(out === 'center' ? 472 : 108, 118)
    context.stroke()
    context.globalAlpha = 1
    context.fillStyle = ink
    context.globalAlpha = 0.78
    context.font = '600 20px "PingFang SC", "Microsoft YaHei", sans-serif'
    context.fillText(design.decor.eyebrow || design.themeName, x, 100)
    context.globalAlpha = 1
  }

  const size = out === 'minimal' ? (title.length > 26 ? 50 : title.length > 16 ? 58 : 66) : title.length > 26 ? 44 : title.length > 16 ? 52 : 58
  context.font = `700 ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`
  const maxWidth = out === 'minimal' ? 760 : 700
  const lines = wrapCoverTitle(context, title || t('未命名文章'), maxWidth)
  const lineHeight = Math.round(size * 1.32)
  const baseY = out === 'bottom' ? 238 : out === 'minimal' ? 220 : 118
  const startY = baseY + (3 - lines.length) * lineHeight * 0.5
  context.fillStyle = ink
  lines.forEach((line, index) => {
    context.fillText(line, x, startY + lineHeight * (index + 1))
  })

  if (out !== 'minimal') {
    context.globalAlpha = 0.7
    context.font = '400 18px "PingFang SC", "Microsoft YaHei", sans-serif'
    context.fillText(design.themeName + ' · ' + design.variantName, x, 348)
    context.globalAlpha = 1
  }
  return canvas.toDataURL('image/png')
}

/** Crop any image into the 900x383 cover frame. */
function cropToCover(dataUrl) {
  return loadImage(dataUrl).then(image => {
    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 383
    const context = canvas.getContext('2d')
    if (context === null) throw new Error(t('当前环境无法处理封面'))
    const targetRatio = 900 / 383
    const sourceRatio = image.width / image.height
    let sourceWidth = image.width
    let sourceHeight = image.height
    let sourceX = 0
    let sourceY = 0
    if (sourceRatio > targetRatio) {
      sourceWidth = image.height * targetRatio
      sourceX = (image.width - sourceWidth) / 2
    } else {
      sourceHeight = image.width / targetRatio
      sourceY = (image.height - sourceHeight) / 2
    }
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, 900, 383)
    return canvas.toDataURL('image/jpeg', 0.92)
  })
}

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

function Button({ children, icon, variant = 'default', ...rest }) {
  const className = `ws-btn ${variant}`
  return h('button', { type: 'button', className, ...rest },
    icon ? h(Icon, { name: icon, size: 14 }) : null,
    h('span', null, children),
  )
}

function IconButton({ icon, title, disabled, onClick }) {
  return h('button', { type: 'button', className: 'ws-icon-btn', title, disabled, onClick, 'aria-label': title },
    h(Icon, { name: icon, size: 15 }),
  )
}

