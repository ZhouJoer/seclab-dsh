/** Shared menu for plugin-contributed conversation creation modes. @module */
import { useState } from 'react'
import { Menu, MenuItemButton, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'

/** Render the creation menu beside the ordinary one-click new-chat button.
 * @param props - native creation action and contributed menu entries.
 * @returns a portalled, keyboard-accessible creation menu. */
export function NewSessionOptions(props: FactoryComponentPropsOf<'sidebar.new.options'>) {
  const [open, setOpen] = useState(false)
  return <Menu open={open} onClose={() => { setOpen(false) }} portal anchor={
    <button className={props.className} aria-label={props.t('session.new.options')} aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(value => !value) }}>
      <IconChevronDownOutlineRegular size={14} />
    </button>
  }>
    <MenuItemButton onSelect={() => { setOpen(false); props.startSession() }}>{props.t('session.new')}</MenuItemButton>
    {props.renderSlot('sidebar.new.item', { close: () => { setOpen(false) } })}
  </Menu>
}
