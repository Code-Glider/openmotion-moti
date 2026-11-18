import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReviewComment, ReviewCommentsInput, ReviewCommentsResult } from '../../../shared/review-comments';
import { requestComments } from './reviewCommentsClient';

/** Abort old reads; stale polling responses never overwrite a newer mutation. */
export function useReviewComments(projectId: string, visible: boolean) {
  const [data, setData] = useState<ReviewCommentsResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false), running = useRef(false), sequence = useRef(0);
  const read = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    read.current?.abort();
    const controller = new AbortController(); read.current = controller;
    const order = ++sequence.current;
    try {
      const result = await requestComments({ action: 'comments', operation: 'list', projectId }, controller.signal);
      if (mounted.current && !controller.signal.aborted && order === sequence.current) { setData(result); setError(''); }
      return result;
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted && order === sequence.current) setError('Could not load comments');
      throw cause;
    }
  }, [projectId]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; sequence.current++; read.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!visible) return;
    const poll = () => {
      if (running.current || document.hidden) return;
      void refresh().catch(() => {});
    };
    poll(); const timer = window.setInterval(poll, 5000);
    window.addEventListener('focus', poll);
    return () => { clearInterval(timer); window.removeEventListener('focus', poll); read.current?.abort(); };
  }, [visible, refresh]);
  async function run<T>(task: () => Promise<T>): Promise<T | undefined> {
    if (running.current) return;
    running.current = true; setBusy(true); read.current?.abort(); sequence.current++;
    try { return await task(); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  async function mutate(input: Omit<ReviewCommentsInput, 'action' | 'projectId'>) {
    try {
      const result = await requestComments({ ...input, action: 'comments', projectId });
      if (mounted.current) { sequence.current++; setData(result); setError(''); }
      return result;
    } catch (cause) {
      if (cause instanceof Error && /^COMMENT_(CONFLICT|NOT_FOUND):/.test(cause.message)) await refresh().catch(() => {});
      throw cause;
    }
  }
  const change = (comment: ReviewComment, operation: 'update' | 'delete', status?: ReviewComment['status']) => mutate({
    operation, commentId: comment.id, expectedCommentRevision: comment.revision, requestId: crypto.randomUUID(), ...(status ? { status } : {}),
  });
  return { data, error, busy, refresh, run, mutate, change };
}
