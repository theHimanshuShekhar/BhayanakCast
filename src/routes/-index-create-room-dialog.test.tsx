// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { FormEvent } from 'react'
import { CreateRoomDialog } from './index'
import { Dialog } from '#/components/ui/dialog'

function renderDialog(onSubmit = vi.fn()) {
  function Wrapper() {
    return (
      <Dialog open>
        <CreateRoomDialog
          createRoom={onSubmit}
          createStatus=""
          privateRoom={false}
          setPrivateRoom={() => undefined}
        />
      </Dialog>
    )
  }

  render(<Wrapper />)
}

afterEach(() => cleanup())

describe('CreateRoomDialog', () => {
  test('selects room kind and tags by click for submission', () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      expect(form.get('category')).toBe('Music')
      expect(form.getAll('tags')).toEqual(['music', 'cozy'])
    })

    renderDialog(onSubmit)
    fireEvent.change(screen.getByPlaceholderText('e.g. sunday synth jams'), {
      target: { value: 'late night radio' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Music' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '#music' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '#cozy' }))
    fireEvent.click(screen.getByRole('button', { name: 'start hang' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
