// Upserts `incoming` items into `existing` by `id`. An item whose id
// already exists is replaced IN PLACE (same position); a genuinely new
// id is prepended, matching the app's existing "newest first" ordering
// convention (e.g. addOrder does `setOrders(prev => [newOrder, ...prev])`).
export function upsertById(existing, incoming) {
  const existingIds = new Set(existing.map(item => item.id));
  const updated = existing.map(item => {
    const match = incoming.find(inc => inc.id === item.id);
    return match ? match : item;
  });
  const newItems = incoming.filter(inc => !existingIds.has(inc.id));
  return [...newItems, ...updated];
}

export function removeById(existing, id) {
  return existing.filter(item => item.id !== id);
}
