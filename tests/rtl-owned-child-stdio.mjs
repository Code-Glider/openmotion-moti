// An owned child may emit 'exit' before its inherited stdio pipes emit
// 'close'. On some CI runners those PipeWraps keep the Studio test's Node
// process alive after the child has stopped. Release only the stdio streams
// of an exited process created by the current integration, never external or
// still-running processes. This does not relax any Studio/MP4 assertions.
export function releaseExitedOwnedChildStdio(child, label) {
  if (!child || typeof child !== 'object' || typeof label !== 'string' || !label) {
    throw new Error('Owned child and diagnostic label are required');
  }
  if (child.exitCode === null && child.signalCode === null) {
    throw new Error(`${label}: refusing to release stdio of a running child`);
  }
  const released = [];
  for (const name of ['stdin', 'stdout', 'stderr']) {
    const stream = child[name];
    if (stream && !stream.destroyed) {
      stream.destroy();
      released.push(name);
    }
  }
  return { label, exitCode: child.exitCode, signalCode: child.signalCode, released };
}
