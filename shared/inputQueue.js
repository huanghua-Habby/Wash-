/** Coalesce waiting motion samples without losing button edges or changing simulation speed. */
export function enqueueInput(queue, packet) {
  const tail = queue.at(-1);
  const sameButtons = tail && tail.down.length === packet.down.length && tail.down.every((key) => packet.down.includes(key));
  if (sameButtons && tail.hits.length === 0 && packet.hits.length === 0 && !tail.struggle && !packet.struggle) {
    queue[queue.length - 1] = packet;
    return true;
  }
  if (queue.length >= 120) return false;
  queue.push(packet);
  return true;
}
