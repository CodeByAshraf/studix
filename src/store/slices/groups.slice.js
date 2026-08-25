// src/store/slices/groups.slice.js

export const createGroupsSlice = (set) => ({
  groups: INITIAL_GROUPS,

  addGroup: (newGroup) =>
    set((state) => ({ groups: [...state.groups, newGroup] })),

  updateGroup: (id, updates) =>
    set((state) => ({
      groups: state.groups.map((g) =>
        g.id === id ? { ...g, ...updates } : g
      ),
    })),

  removeGroup: (id) =>
    set((state) => ({ groups: state.groups.filter((g) => g.id !== id) })),

  // للتوافق مع setGroups(prev => ...)
  setGroups: (groupsOrUpdater) =>
    set((state) => ({
      groups:
        typeof groupsOrUpdater === 'function'
          ? groupsOrUpdater(state.groups)
          : groupsOrUpdater,
    })),
});
import { INITIAL_GROUPS } from '../../data/initialData';
