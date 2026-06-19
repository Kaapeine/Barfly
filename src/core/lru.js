export function touchDynamic(order, id) {
  if (!order.includes(id)) return order;
  return [id, ...order.filter((x) => x !== id)];
}

export function addDynamic(order, id, capacity) {
  const withNew = [id, ...order.filter((x) => x !== id)];
  return evictToCapacity(withNew, capacity);
}

export function evictToCapacity(order, capacity) {
  if (order.length <= capacity) return { order, evicted: [] };
  return {
    order: order.slice(0, capacity),
    evicted: order.slice(capacity),
  };
}