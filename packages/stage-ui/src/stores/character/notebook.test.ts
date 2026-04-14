import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useCharacterNotebookStore } from './notebook'

describe('useCharacterNotebookStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('addNote', () => {
    it('adds entry with kind "note"', () => {
      const store = useCharacterNotebookStore()
      const entry = store.addNote('test note')
      expect(entry.kind).toBe('note')
      expect(entry.text).toBe('test note')
      expect(store.entries).toHaveLength(1)
    })
  })

  describe('addDiaryEntry', () => {
    it('adds entry with kind "diary"', () => {
      const store = useCharacterNotebookStore()
      const entry = store.addDiaryEntry('dear diary')
      expect(entry.kind).toBe('diary')
      expect(entry.text).toBe('dear diary')
    })
  })

  describe('addFocusEntry', () => {
    it('adds entry with kind "focus"', () => {
      const store = useCharacterNotebookStore()
      const entry = store.addFocusEntry('focus item')
      expect(entry.kind).toBe('focus')
      expect(entry.text).toBe('focus item')
    })
  })

  describe('entry shape', () => {
    it('has id, text, createdAt, tags, and metadata', () => {
      const store = useCharacterNotebookStore()
      const entry = store.addNote('shape test')
      expect(entry.id).toBeTypeOf('string')
      expect(entry.id.length).toBeGreaterThan(0)
      expect(entry.text).toBe('shape test')
      expect(entry.createdAt).toBeTypeOf('number')
      expect(entry.tags).toBeUndefined()
      expect(entry.metadata).toBeUndefined()
    })

    it('stores tags and metadata from options', () => {
      const store = useCharacterNotebookStore()
      const entry = store.addNote('with options', {
        tags: ['important', 'work'],
        metadata: { source: 'test' },
      })
      expect(entry.tags).toEqual(['important', 'work'])
      expect(entry.metadata).toEqual({ source: 'test' })
    })
  })

  describe('scheduleTask', () => {
    it('creates task with status "queued" when no dueAt', () => {
      const store = useCharacterNotebookStore()
      const task = store.scheduleTask({ title: 'do something' })
      expect(task.status).toBe('queued')
      expect(task.title).toBe('do something')
      expect(task.dueAt).toBeUndefined()
    })

    it('creates task with status "scheduled" when dueAt is provided', () => {
      const store = useCharacterNotebookStore()
      const task = store.scheduleTask({ title: 'later', dueAt: Date.now() + 60000 })
      expect(task.status).toBe('scheduled')
      expect(task.dueAt).toBeTypeOf('number')
    })

    it('defaults priority to "normal"', () => {
      const store = useCharacterNotebookStore()
      const task = store.scheduleTask({ title: 'default priority' })
      expect(task.priority).toBe('normal')
    })
  })

  describe('markTaskDone', () => {
    it('sets status to "done" and updates updatedAt', () => {
      const store = useCharacterNotebookStore()
      const task = store.scheduleTask({ title: 'finish me' })
      const originalUpdatedAt = task.updatedAt

      // Small delay to ensure updatedAt changes
      store.markTaskDone(task.id)

      const updated = store.tasks.find(t => t.id === task.id)!
      expect(updated.status).toBe('done')
      expect(updated.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt)
    })

    it('does nothing with invalid id', () => {
      const store = useCharacterNotebookStore()
      store.scheduleTask({ title: 'keep me' })
      const before = [...store.tasks]
      store.markTaskDone('nonexistent-id')
      expect(store.tasks).toEqual(before)
    })
  })

  describe('getDueTasks', () => {
    it('returns tasks that are due within the window', () => {
      const store = useCharacterNotebookStore()
      const now = Date.now()
      store.scheduleTask({ title: 'due soon', dueAt: now + 500 })
      store.scheduleTask({ title: 'due later', dueAt: now + 20000 })

      const due = store.getDueTasks(now, 1000)
      expect(due).toHaveLength(1)
      expect(due[0].title).toBe('due soon')
    })

    it('excludes done and dropped tasks', () => {
      const store = useCharacterNotebookStore()
      const now = Date.now()
      const task = store.scheduleTask({ title: 'done task', dueAt: now })
      store.markTaskDone(task.id)

      const due = store.getDueTasks(now, 10000)
      expect(due).toHaveLength(0)
    })

    it('excludes tasks with nextNotifyAt in the future', () => {
      const store = useCharacterNotebookStore()
      const now = Date.now()
      const task = store.scheduleTask({ title: 'snoozed', dueAt: now })
      store.markTaskNotified(task.id, now + 60000)

      const due = store.getDueTasks(now, 10000)
      expect(due).toHaveLength(0)
    })

    it('treats tasks without dueAt as due now', () => {
      const store = useCharacterNotebookStore()
      const now = Date.now()
      store.scheduleTask({ title: 'no due date' })

      const due = store.getDueTasks(now, 1000)
      expect(due).toHaveLength(1)
      expect(due[0].title).toBe('no due date')
    })
  })

  describe('partitionDiary', () => {
    it('filters entries to only diary kind', () => {
      const store = useCharacterNotebookStore()
      store.addNote('note1')
      store.addDiaryEntry('diary1')
      store.addFocusEntry('focus1')
      store.addDiaryEntry('diary2')

      expect(store.partitionDiary).toHaveLength(2)
      expect(store.partitionDiary.every(e => e.kind === 'diary')).toBe(true)
    })
  })

  describe('partitionFocus', () => {
    it('filters entries to only focus kind', () => {
      const store = useCharacterNotebookStore()
      store.addNote('note1')
      store.addFocusEntry('focus1')
      store.addDiaryEntry('diary1')
      store.addFocusEntry('focus2')

      expect(store.partitionFocus).toHaveLength(2)
      expect(store.partitionFocus.every(e => e.kind === 'focus')).toBe(true)
    })
  })
})
