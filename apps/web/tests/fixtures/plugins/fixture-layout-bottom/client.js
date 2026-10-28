/** Root-scoped bottom content with occupant-owned height and local input state. */
window.__ModuleLoader__.load({
  id: '@fixture/layout-bottom',
  factory(require) {
    const React = require('react')
    const { Button } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    function Bottom({ t, center, frame }) {
      const [height, setHeight] = React.useState(240)
      if (height === 0) return null
      return h('section', {
        'aria-label': t('title'), 'data-bottom-fixture': '',
        style: { height, boxSizing: 'border-box', padding: 16 },
      },
      h('input', { 'aria-label': t('input') }),
      h(Button, { onClick: center }, t('center')),
      h(Button, { onClick: frame }, t('frame')),
      h(Button, { onClick: () => setHeight(360) }, t('grow')),
      h(Button, { onClick: () => setHeight(0) }, t('collapse')))
    }
    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        const labels = { title: 'Bottom content', input: 'Bottom input', grow: 'Grow bottom', collapse: 'Collapse bottom',
          center: 'Center bottom', frame: 'Frame bottom' }
        let release = () => {}
        ctx.effect(() => () => release())
        ctx.effect(() => ctx.locale.register('fixtureBottom', { en: labels, zh: labels }))
        ctx.slots.inject('shell.bottom', () => ctx.slots.register({
          name: 'shell.bottom', locale: 'fixtureBottom',
          inject: () => ({ center: () => { release(); release = ctx.layout.registerBottomPlacement('center') }, frame: () => release() }),
        }, Bottom))
      },
    }
  },
})
