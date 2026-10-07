const seedTime = Date.UTC(2026, 9, 7, 9);
const labels = {
  email: ['A note from a friend', 'The weekend plan', 'A little reading for later', 'Photos from the walk', 'Dinner on Thursday?', 'Your monthly reading list', 'A new idea to share', 'A small project update'],
  agents: ['Claude · research notes', 'Muse · a new direction', 'Claude · code review', 'Muse · morning sketch', 'Claude · reading together'],
  other: ['A document changed', 'A saved article', 'A calendar invitation', 'A message from the team'],
};

export function initialItems() {
  return Object.entries(labels).flatMap(([category, titles]) => titles.map((title, index) => ({
    itemId: `sample:${category}:${index + 1}`, sourceId: String(index + 1), source: 'sample', accountId: 'demo', category, title,
    readState: category === 'email' ? index % 3 === 0 ? 'unread' : 'read' : 'unknown',
    updatedAt: seedTime + index * 1000, revision: 1,
  })));
}

// This fixture mirrors the inputs branch boundary. Replaying a delivery does
// not create another bird, and a delayed upsert cannot undo an archive.
export function createSampleStore(items = initialItems()) {
  const state = new Map(items.map(item => [item.itemId, { ...item }]));
  const revisions = new Map(items.map(item => [item.itemId, item.revision]));
  const seen = new Set();
  return {
    items: () => [...state.values()].map(item => ({ ...item })),
    get: id => state.has(id) ? { ...state.get(id) } : null,
    apply(event) {
      if (!event?.eventId || seen.has(event.eventId)) return [];
      seen.add(event.eventId);
      if (!Number.isInteger(event.revision) || event.revision <= (revisions.get(event.itemId) ?? 0)) return [];
      if (!['upsert', 'remove', 'activity'].includes(event.type)) return [];
      if (event.type === 'upsert' && (!event.item || event.item.itemId !== event.itemId)) return [];
      revisions.set(event.itemId, event.revision);
      if (event.type === 'remove') state.delete(event.itemId);
      else if (event.type === 'upsert') state.set(event.itemId, { ...event.item, revision: event.revision, updatedAt: event.occurredAt });
      else if (state.has(event.itemId)) state.set(event.itemId, { ...state.get(event.itemId), revision: event.revision, updatedAt: event.occurredAt });
      return [{ ...event }];
    },
  };
}

export const sampleMinute = [
  { at: 0, action: 'arrival', text: 'A new email is coming in.' },
  { at: 3300, action: 'read', text: 'Read the new email. Its bird stays on the wire.' },
  { at: 5400, action: 'reply', text: 'An agent replies. The same bird stirs.' },
  { at: 7400, action: 'archive', text: 'Archive the email. Its bird takes off.' },
  { at: 9800, action: 'document', text: 'A document joins the Other wire.' },
];
