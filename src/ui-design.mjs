function DesignPanel(props) {
  const { store, design, doc, analysis, features, hostStatus, setHostStatus, tab, setTab, toast, parsed, article, showClose, onClose, autoRefine, setAutoRefine, refining, onRefineNow } = props
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
        h(AiSection, { store, design, doc, parsed, hostStatus, toast })),
      h('div', { className: 'ws-pane' + (tab === 'theme' ? '' : ' ws-pane-hidden') },
        h(ThemeSection, { store, design, analysis, doc, toast, autoRefine, setAutoRefine, refining, onRefineNow })),
      h('div', { className: 'ws-pane' + (tab === 'type' ? '' : ' ws-pane-hidden') },
        h(TypeSection, { store, design, toast })),
      h('div', { className: 'ws-pane' + (tab === 'decor' ? '' : ' ws-pane-hidden') },
        h(DecorSection, { store, design, toast })),
      h('div', { className: 'ws-pane' + (tab === 'publish' ? '' : ' ws-pane-hidden') },
        h(PublishSection, {
          store, design, doc, parsed, article, features, hostStatus, setHostStatus, toast,
        })),
    ),
  )
}

function AiSection(props) {
  const { store, design, doc, parsed, hostStatus, toast } = props
  const [messages, setMessages] = React.useState([])
  const [input, setInput] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [phase, setPhase] = React.useState('')
  const [chunked, setChunked] = React.useState(false)
  const listRef = React.useRef(null)
  const inputRef = React.useRef(null)

  React.useEffect(() => {
    const element = listRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages, busy])

  const send = async (override) => {
    const instruction = String(override ?? input).trim()
    if (instruction === '' || busy) return
    if (doc.text.trim() === '') {
      toast('编辑区还是空的，先写点内容', 'error')
      return
    }
    setInput('')
    const sentText = doc.text
    setMessages(list => [...list, { role: 'user', content: instruction }])
    setBusy(true)
    setProgress(0)
    setPhase('')
    try {
      let value
      const useChunks = chunked && doc.text.length > LONG_TEXT_CHUNK_THRESHOLD
      if (useChunks) {
        const chunks = splitMarkdownChunks(doc.text, 3200)
        if (chunks.length === 0) throw Object.assign(new Error('文章为空，无法分段'), { code: 'text-required' })
        if (chunks.length > 8) throw Object.assign(new Error(`文章会拆成 ${chunks.length} 段，超过 8 段上限；先手动拆成几篇再改`), { code: 'too-many-chunks' })
        const rewritten = []
        for (let index = 0; index < chunks.length; index += 1) {
          setPhase(`第 ${index + 1}/${chunks.length} 段改写中`)
          const part = await callHost('aiEdit', {
            instruction: `${instruction}\n\n（这是全文第 ${index + 1}/${chunks.length} 段。只改写这一段，保持 Markdown 结构；不要输出 design；不要添加原文没有的事实。）`,
            text: chunks[index],
            title: doc.meta.title,
            design: doc.design,
            meta: { author: doc.meta.author, digest: doc.meta.digest },
            history: [],
          }, { timeoutMs: 150000 })
          if (typeof part.text !== 'string' || part.text.trim() === '') {
            throw Object.assign(new Error(`第 ${index + 1} 段没有返回改写结果，已取消，正文未改。`), { code: 'chunk-missing' })
          }
          rewritten.push(part.text.trim())
        }
        value = { reply: `分段改写完成（${chunks.length} 段），版式未改。`, text: rewritten.join('\n\n') }
      } else {
        setPhase(t('模型生成中'))
        value = await callHostStream('aiEditStream', {
          instruction,
          text: doc.text,
          title: doc.meta.title,
          design: doc.design,
          meta: { author: doc.meta.author, digest: doc.meta.digest },
          history: messages.slice(-6).map(message => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content })),
        }, { timeoutMs: 150000, onProgress: chars => setProgress(chars) })
      }

      const applied = []
      const current = store.doc
      const typedMeanwhile = typeof value.text === 'string' && current.text !== sentText
      const nextText = typeof value.text === 'string' && value.text.trim() !== '' && value.text !== current.text && !typedMeanwhile
        ? value.text
        : undefined
      let nextDesign
      if (value.design && typeof value.design === 'object') {
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
      const nextMeta = value.meta && typeof value.meta === 'object' ? { ...current.meta, ...value.meta } : undefined
      if (nextText !== undefined) applied.push('正文')
      if (nextDesign !== undefined) applied.push('版式')
      if (nextMeta !== undefined) applied.push('标题/摘要')
      if (applied.length > 0) {
        store.updateDoc(state => ({
          ...state,
          ...(nextText === undefined ? {} : { text: nextText }),
          ...(nextDesign === undefined ? {} : { design: nextDesign }),
          ...(nextMeta === undefined ? {} : { meta: nextMeta }),
        }))
      }
      if (typedMeanwhile) applied.push('正文有改动，未覆盖')
      setMessages(list => [...list, {
        role: 'assistant',
        content: value.reply || t('已修改'),
        applied,
        canUndo: applied.length > 0,
        model: value.model?.model ?? '',
        parseError: value.parseError === true,
      }])
      if (applied.length > 0) toast(`AI 已修改：${applied.join('、')}`, 'success')
    } catch (error) {
      setMessages(list => [...list, { role: 'error', content: error.message || t('修改失败'), code: error.code }])
    } finally {
      setBusy(false)
      setPhase('')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
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
        h('p', null, '直接说想怎么改，AI 会改正文、换主题或调版式，改完可以撤销。'),
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
            ? h('div', { className: 'ws-msg-model' }, '可以缩小改动范围再试一次；连续失败就去「设置 → 模型」检查当前默认模型。')
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
          message.parseError ? h('div', { className: 'ws-msg-model' }, '模型没有按结构返回，只显示了说明') : null,
        )),
        busy ? h('div', { className: 'ws-msg assistant typing' },
          h('span', { className: 'ws-typing-dot' }), h('span', { className: 'ws-typing-dot' }), h('span', { className: 'ws-typing-dot' }),
          h('span', { className: 'ws-msg-body' }, progress > 0 ? `模型已生成 ${progress} 字…` : (phase === '' ? '正在按你的要求修改…' : phase)),
        ) : null,
      ),
    doc.text.length > LONG_TEXT_CHUNK_THRESHOLD
      ? h('div', { className: 'ws-chat-compose-option' },
        h(Toggle, {
          label: `长文分段改写（约 ${splitMarkdownChunks(doc.text, 3200).length} 段，只改正文）`,
          checked: chunked,
          onChange: setChunked,
        }),
        chunked ? h('p', { className: 'ws-hint' }, '会按小节拆成多段分别调用模型，耗时和费用更高；版式不会变。') : null,
      )
      : null,
    h('div', { className: 'ws-chat-compose' },
      h('textarea', {
        ref: inputRef,
        className: 'ws-input ws-textarea',
        rows: 2,
        value: input,
        placeholder: '说一句想怎么改，例如：把标题改短一点，第二段压到两行',
        onChange: event => setInput(event.target.value),
        onKeyDown: event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing && event.keyCode !== 229) {
            event.preventDefault()
            send()
          }
        },
      }),
      h('div', { className: 'ws-row' },
        h(Button, { variant: 'primary', disabled: busy || input.trim() === '', onClick: () => send() }, busy ? '修改中…' : '发送'),
        h('span', { className: 'ws-hint' }, 'Enter 发送，Shift+Enter 换行'),
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
    h('p', { className: 'ws-hint' }, '模型是当前会话的默认模型；要求改版式时只动主题与装饰，不会重写正文。'),
  )
}

function ThemeSection(props) {
  const { store, design, analysis, doc, toast, autoRefine, setAutoRefine, refining, onRefineNow } = props
  const activeTheme = THEMES.find(theme => theme.id === design.themeId) ?? THEMES[0]
  const applyTheme = (theme) => {
    store.updateDoc(current => ({
      ...current,
      design: {
        themeId: theme.id,
        variantId: theme.variants[0].id,
        overrides: {
          eyebrow: current.design?.overrides?.eyebrow ?? analysis.label,
          showEyebrow: ['eyebrow', 'tag', 'centered', 'kicker'].includes(theme.variants[0].titleStyle),
        },
      },
    }))
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
      h('p', { className: 'ws-hint' }, '这份分析只看标题、结构、关键词与篇幅，不联网，也不改动你的正文。'),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('自动编排'))),
      h('p', { className: 'ws-hint' }, '粘贴或上传文档后，先本地按内容套一版（不联网、立即出效果），随后可让 AI 再精排一次。'),
      h(Toggle, { label: '粘贴 / 上传后让 AI 精排', checked: autoRefine, onChange: setAutoRefine }),
      h(Button, { onClick: onRefineNow, disabled: refining }, refining ? 'AI 正在精排…' : '现在就 AI 精排'),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, '主题库'), h('span', { className: 'ws-group-note' }, `${THEMES.reduce((count, entry) => count + entry.variants.length, 0)} 个版式`)),
      h('div', { className: 'ws-themes' },
        THEMES.map(theme => h('button', {
          key: theme.id,
          type: 'button',
          className: 'ws-theme' + (theme.id === activeTheme.id ? ' on' : ''),
          onClick: () => applyTheme(theme),
        },
        h('span', { className: 'ws-theme-swatch', style: { background: theme.palette.bg, borderColor: theme.palette.border } },
          h('i', { style: { background: theme.palette.text } }),
          h('i', { style: { background: theme.palette.accent } }),
          h('i', { style: { background: theme.palette.accentSoft } }),
        ),
        h('span', { className: 'ws-theme-meta' },
          h('span', { className: 'ws-theme-name' }, theme.name),
          h('span', { className: 'ws-theme-tag' }, theme.tagline.slice(0, 14)),
        ),
        ),
        ),
      ),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, t('版式变体'))),
      h('div', { className: 'ws-chips' },
        activeTheme.variants.map(variant => h('button', {
          key: variant.id,
          type: 'button',
          className: 'ws-chip' + (variant.id === design.variantId ? ' on' : ''),
          onClick: () => setVariant(variant.id),
        }, variant.name)),
      ),
      h('p', { className: 'ws-hint' }, activeTheme.tagline),
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
      h('p', { className: 'ws-hint' }, '显示在标题上方的标签位：封面、环形与居中版式会用到。'),
    ),
  )
}

function formatSlider(value) {
  if (typeof value !== 'number') return String(value)
  return Number.isInteger(value) ? String(value) : value.toFixed(value < 0.1 ? 3 : 2)
}

function TypeSection(props) {
  const { store, design, toast } = props
  const set = (patch) => store.updateDesign(current => ({ ...current, overrides: { ...(current.overrides ?? {}), ...patch } }))
  const rows = [
    { key: 'titleSize', label: t('标题字号'), value: design.type.titleSize, min: 20, max: 40, step: 1, unit: 'px' },
    { key: 'bodySize', label: t('正文字号'), value: design.type.bodySize, min: 13, max: 20, step: 0.5, unit: 'px' },
    { key: 'lineHeight', label: t('正文行高'), value: design.type.lineHeight, min: 1.5, max: 2.4, step: 0.05, unit: '' },
    { key: 'letterSpacing', label: t('字间距'), value: design.type.letterSpacing, min: 0, max: 0.06, step: 0.005, unit: 'em' },
    { key: 'paraGap', label: t('段间距'), value: design.type.paraGap, min: 10, max: 40, step: 1, unit: 'px' },
    { key: 'paddingX', label: t('左右留白'), value: design.layout.paddingX, min: 8, max: 28, step: 1, unit: 'px' },
  ]
  const reset = () => {
    store.updateDesign(current => ({ themeId: current.themeId, variantId: current.variantId, overrides: {} }))
    toast('已恢复当前主题的默认排版')
  }
  return h('div', { className: 'ws-sections' },
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
    ['rule', t('通栏细线')], ['ribbon', t('色块标题')], ['tag', t('标签 + 标题')], ['boxed', t('边框卡片')],
    ['vertical', t('左侧竖线')], ['underline', t('下划短线')], ['centered', t('居中 + 短线')], ['eyebrow', t('眉标 + 大标题')],
  ],
  sectionStyle: [
    ['bar', t('左侧色条')], ['tag', t('色块标签')], ['numbered', t('章节编号')], ['line', t('居中细线')], ['dot', t('圆点')], ['ghost', t('大号数字')],
  ],
  quoteStyle: [
    ['bar', t('左侧竖线')], ['card', t('卡片')], ['center', t('居中引号')], ['tint', t('浅色底')], ['stamp', t('描边摘录')],
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
    store.updateDesign(current => ({ themeId: current.themeId, variantId: current.variantId, overrides: {} }))
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
      h('div', { className: 'ws-hint' }, '底纹与角标都会写进复制/发布的 HTML；深色背景会自动换成浅色文字。'),
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
      h('p', { className: 'ws-hint' }, '图片样式选「通栏」时会忽略宽度。悬停图片可以点工具条里的图标换图。'),
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
        placeholder: '署名，例如：文 / 张三',
        onChange: event => set({ footerSign: event.target.value }),
      }),
    ),
  )
}

/* ------------------------------------------------------------------ *
 * Publish flow
 * ------------------------------------------------------------------ */

function PublishSection(props) {
  const { store, design, doc, parsed, features, hostStatus, setHostStatus, toast } = props
  const [configOpen, setConfigOpen] = React.useState(false)
  const [appId, setAppId] = React.useState('')
  const [appSecret, setAppSecret] = React.useState('')
  const [configBusy, setConfigBusy] = React.useState(false)
  const [steps, setSteps] = React.useState([])
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [confirmPublish, setConfirmPublish] = React.useState(false)
  const [coverBusy, setCoverBusy] = React.useState(false)
  const [bundleIds, setBundleIds] = React.useState([])
  const [draftBox, setDraftBox] = React.useState({ phase: 'idle', items: [], error: '' })
  const [draftBusy, setDraftBusy] = React.useState(false)
  const [deleteArm, setDeleteArm] = React.useState('')
  const deleteArmTimer = React.useRef(undefined)
  React.useEffect(() => () => clearTimeout(deleteArmTimer.current), [])
  const coverInputRef = React.useRef(null)
  const title = (doc.meta.title.trim() || parsed.title || '').trim()
  const author = doc.meta.author.trim()
  const digest = doc.meta.digest.trim() || deriveDigest(parsed.blocks)
  const coverDataUrl = doc.meta.coverDataUrl || ''

  React.useEffect(() => {
    // Keep the generated cover in step with the current theme; a cover the user
    // uploaded themselves stays untouched.
    if (doc.meta.coverCustom === true) return
    try {
      const generated = renderCover({ title, design })
      if (generated !== coverDataUrl) store.updateMeta({ coverDataUrl: generated })
    } catch {
      // Canvas may be unavailable in unusual embedders; the publish step reports it.
    }
  }, [title, design.themeId, design.variantId, design.colors.accent, coverDataUrl, doc.meta.coverCustom])

  const regenerateCover = () => {
    try {
      store.updateMeta({ coverDataUrl: renderCover({ title, design }), coverCustom: false })
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

  const saveConfig = async () => {
    setConfigBusy(true)
    try {
      const value = await callHost('saveConfig', { appId: appId.trim(), appSecret: appSecret.trim() })
      setHostStatus({ phase: 'ready', configured: value.configured === true, appIdPreview: value.appIdPreview ?? null, message: '' })
      setConfigOpen(false)
      setAppId('')
      setAppSecret('')
      toast(t('公众号密钥已保存到本机凭据库'), 'success')
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
      toast(failure.message || t('连接失败'), 'error')
    } finally {
      setConfigBusy(false)
    }
  }

  const clearConfig = async () => {
    setConfigBusy(true)
    try {
      await callHost('clearConfig')
      setHostStatus({ phase: 'ready', configured: false, appIdPreview: null, message: '' })
      toast('已清除本机保存的公众号密钥')
    } catch (failure) {
      toast(failure.message || t('清除失败'), 'error')
    } finally {
      setConfigBusy(false)
    }
  }

  const loadDrafts = async () => {
    setDraftBusy(true)
    try {
      const value = await callHost('listDrafts', { count: 10 })
      setDraftBox({ phase: 'ready', items: Array.isArray(value.items) ? value.items : [], error: '' })
    } catch (failure) {
      setDraftBox({ phase: 'error', items: [], error: failure.message || t('读取草稿箱失败') })
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
      setDraftBox(current => ({ ...current, items: current.items.filter(item => item.mediaId !== mediaId) }))
      toast(t('草稿已删除'))
    } catch (failure) {
      toast(failure.message || t('删除失败'), 'error')
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

      push(`写入公众号草稿箱${preparedArticles.length > 1 ? `（${preparedArticles.length} 篇）` : ''}`, 'running')
      const draft = await callHost('createDraft', { articles: preparedArticles }, { timeoutMs: 120000 })
      const warnings = Array.isArray(draft.warnings) ? draft.warnings : []
      setSteps(list => list.map((step, index) => (index === list.length - 1 ? { ...step, state: 'done', detail: warnings.join('；') || draft.mediaId } : step)))
      setResult({ kind: 'draft', mediaId: draft.mediaId, warnings, count: preparedArticles.length })

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
          status = { publishStatus: -1, statusText: '状态查询失败，发布可能仍在继续，稍后到公众号后台确认' }
        }
        setResult({ kind: 'published', mediaId: draft.mediaId, publishId: published.publishId, status, count: preparedArticles.length })
        push(
          t('发布结果'),
          status?.publishStatus === 0 || status?.publishStatus === 1 ? 'done' : status?.publishStatus === -1 ? 'running' : 'error',
          status?.statusText ?? t('状态未知'),
        )
      }
      toast(mode === 'publish' ? '已提交发布，结果见下方状态' : '已保存到公众号草稿箱', 'success')
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
        h('span', { className: 'ws-badge ' + (hostStatus.configured ? 'ok' : '') }, hostStatus.configured ? '已连接' : hostStatus.phase === 'error' ? '服务未响应' : '未配置'),
      ),
      hostStatus.phase === 'error'
        ? h('p', { className: 'ws-hint danger' }, hostStatus.message)
        : null,
      hostStatus.configured
        ? h('p', { className: 'ws-hint' }, `AppID：${hostStatus.appIdPreview ?? '（已保存）'}。密钥只在本机凭据库，页面拿不到明文。`)
        : h('p', { className: 'ws-hint' }, '在公众号后台「设置与开发 → 基本配置」拿到 AppID 与 AppSecret。还需要把本机出口 IP 加进白名单。'),
      configOpen
        ? h('div', { className: 'ws-config' },
          h('label', { className: 'ws-field' }, h('span', { className: 'ws-field-label' }, 'AppID'), h('input', { className: 'ws-input', value: appId, placeholder: 'wx 开头的一串字符', onChange: event => setAppId(event.target.value) })),
          h('label', { className: 'ws-field' }, h('span', { className: 'ws-field-label' }, 'AppSecret'), h('input', { className: 'ws-input', type: 'password', value: appSecret, placeholder: '32 位密钥，保存后不再显示', onChange: event => setAppSecret(event.target.value) })),
          h('div', { className: 'ws-row' },
            h(Button, { variant: 'primary', disabled: configBusy || appId.trim() === '' || appSecret.trim() === '', onClick: saveConfig }, configBusy ? '保存中…' : '保存'),
            h(Button, { onClick: () => setConfigOpen(false) }, t('取消')),
          ),
        )
        : h('div', { className: 'ws-row' },
          h(Button, { variant: hostStatus.configured ? 'ghost' : 'primary', onClick: () => setConfigOpen(true), disabled: hostStatus.phase === 'error' }, hostStatus.configured ? '更新密钥' : '填写密钥'),
          hostStatus.configured ? h(Button, { onClick: testConnection, disabled: configBusy }, configBusy ? t('测试中…') : t('测试连接')) : null,
          hostStatus.configured ? h(Button, { onClick: clearConfig, disabled: configBusy, variant: 'ghost' }, t('清除')) : null,
        ),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' }, h('span', null, '文章信息'), h('span', { className: 'ws-group-note' }, `标题 ${title.length}/64 · 摘要 ${digest.length}/120`)),
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
        if (candidates.length === 0) return h('p', { className: 'ws-hint' }, '只有当前草稿。新建几篇本地草稿后，可以把它们一起保存成多图文草稿。')
        return [
          h('p', { className: 'ws-hint' }, '把其他本地草稿加入，一起保存成公众号多图文草稿（最多 8 篇，含当前这篇）。'),
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
      h('div', { className: 'ws-group-head' }, h('span', null, '封面（2.35:1）'), h('span', { className: 'ws-group-note' }, doc.meta.coverCustom === true ? '当前是自定义封面' : '自动按主题生成')),
      coverDataUrl !== ''
        ? h('img', { className: 'ws-cover', src: coverDataUrl, alt: t('封面预览') })
        : h('div', { className: 'ws-cover ws-cover-empty' }, t('封面生成中…')),
      h('div', { className: 'ws-row' },
        h(Button, { onClick: regenerateCover, disabled: coverBusy }, t('按主题重绘')),
        h(Button, { onClick: () => coverInputRef.current?.click(), disabled: coverBusy }, coverBusy ? t('处理中…') : t('上传图片')),
        h('input', { ref: coverInputRef, type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: uploadCoverFile }),
      ),
    ),
    h('div', { className: 'ws-publish-actions' },
      h(Button, { icon: 'save', variant: 'primary', disabled: busy || hostStatus.phase === 'error', onClick: () => runPublish('draft') }, busy ? '处理中…' : '保存到草稿箱'),
      confirmPublish
        ? h('div', { className: 'ws-confirm' },
          h('span', null, t('直接发布会占用当天发布次数，确认？')),
          h(Button, { variant: 'danger', onClick: () => runPublish('publish'), disabled: busy }, t('确认发布')),
          h(Button, { variant: 'ghost', onClick: () => setConfirmPublish(false) }, t('再想想')),
        )
        : h(Button, { icon: 'send', variant: 'solid', disabled: busy || hostStatus.phase === 'error', onClick: () => setConfirmPublish(true) }, '直接发布'),
    ),
    h('div', { className: 'ws-group' },
      h('div', { className: 'ws-group-head' },
        h('span', null, t('公众号草稿箱')),
        h('button', { type: 'button', className: 'ws-link', onClick: loadDrafts, disabled: draftBusy || hostStatus.configured !== true }, draftBusy ? '读取中…' : '读取最近 10 篇'),
      ),
      draftBox.phase === 'error' ? h('p', { className: 'ws-hint ws-error-text' }, draftBox.error) : null,
      draftBox.phase === 'ready' && draftBox.items.length === 0 ? h('p', { className: 'ws-hint' }, '草稿箱是空的。') : null,
      draftBox.items.map(item => h('div', { key: item.mediaId, className: 'ws-draft-row' },
        h('div', { className: 'ws-draft-main' },
          h('span', { className: 'ws-draft-title' }, item.title === '' ? '（无标题）' : item.title),
          h('span', { className: 'ws-draft-meta' }, item.updateTime > 0 ? new Date(item.updateTime * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : t('时间未知')),
        ),
        h('button', { type: 'button', className: 'ws-link danger', onClick: () => removeDraft(item.mediaId) }, deleteArm === item.mediaId ? '确认删除' : '删除'),
      )),
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
        error.code === 'ip-not-allowed' ? h('p', null, '打开公众号后台 → 设置与开发 → 基本配置 → IP白名单，加入提示里的 IP 后重试。') : null,
        error.code === 'api-unauthorized' ? h('p', null, '未认证的订阅号通常没有发布接口，改用「保存到草稿箱」或「复制 HTML」。') : null,
        error.code === 'not-configured' ? h('p', null, '先在上方填写 AppID 和 AppSecret。') : null,
      )
      : null,
    result
      ? h('div', { className: 'ws-result' },
        h('strong', null, result.kind === 'published' ? '已提交发布' : '已进入草稿箱'),
        result.kind === 'draft' ? h('p', null, result.count > 1 ? `已写入 ${result.count} 篇多图文草稿，到公众号后台「内容管理 → 草稿箱」查看。` : '到公众号后台「内容管理 → 草稿箱」就能看到这篇，手机预览后手动发布。') : null,
        result.kind === 'published'
          ? h('p', null, `发布状态：${result.status?.statusText ?? '发布中，稍后可在后台查看'}`)
          : null,
        result.warnings && result.warnings.length > 0 ? h('p', null, `提示：${result.warnings.join('；')}`) : null,
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

function renderCover({ title, design }) {
  const canvas = document.createElement('canvas')
  canvas.width = 900
  canvas.height = 383
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('当前环境无法生成封面')
  const accent = design.colors.accent
  const ink = design.colors.accentInk
  const gradient = context.createLinearGradient(0, 0, 900, 383)
  gradient.addColorStop(0, mixHex(accent, '#000000', 0.05))
  gradient.addColorStop(0.55, accent)
  gradient.addColorStop(1, mixHex(accent, '#000000', 0.42))
  context.fillStyle = gradient
  context.fillRect(0, 0, 900, 383)

  context.globalAlpha = 0.08
  context.fillStyle = ink
  context.beginPath()
  context.arc(760, 90, 150, 0, Math.PI * 2)
  context.fill()
  context.beginPath()
  context.arc(845, 330, 110, 0, Math.PI * 2)
  context.fill()
  context.globalAlpha = 1

  context.strokeStyle = ink
  context.globalAlpha = 0.35
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(64, 118)
  context.lineTo(64 + 44, 118)
  context.stroke()
  context.globalAlpha = 1

  context.fillStyle = ink
  context.globalAlpha = 0.78
  context.font = '600 20px "PingFang SC", "Microsoft YaHei", sans-serif'
  context.fillText(design.decor.eyebrow || design.themeName, 64, 100)
  context.globalAlpha = 1

  const size = title.length > 26 ? 44 : title.length > 16 ? 52 : 58
  context.font = `700 ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`
  const lines = wrapCoverTitle(context, title || '未命名文章', 700)
  const lineHeight = Math.round(size * 1.32)
  const startY = 118 + (3 - lines.length) * lineHeight * 0.5
  context.fillStyle = ink
  lines.forEach((line, index) => {
    context.fillText(line, 64, startY + lineHeight * (index + 1))
  })

  context.globalAlpha = 0.7
  context.font = '400 18px "PingFang SC", "Microsoft YaHei", sans-serif'
  context.fillText(design.themeName + ' · ' + design.variantName, 64, 340)
  context.globalAlpha = 1
  return canvas.toDataURL('image/png')
}

/** Crop any image into the 900x383 cover frame. */
function cropToCover(dataUrl) {
  return loadImage(dataUrl).then(image => {
    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 383
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('当前环境无法处理封面')
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

