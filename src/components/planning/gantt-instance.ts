import Gantt, { type GanttOptions, type GanttTask } from "frappe-gantt";

export function createGantt(element: HTMLElement, tasks: GanttTask[], options: GanttOptions) {
  // Frappe 1.2.2 attaches an anonymous document mouseup listener and has no destroy().
  // Capture additions only during its synchronous constructor; always restore the DOM API.
  const original = document.addEventListener;
  const listeners: { type: string; listener: EventListenerOrEventListenerObject; options?: boolean | AddEventListenerOptions }[] = [];
  document.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject | null, settings?: boolean | AddEventListenerOptions) => {
    if (listener) { listeners.push({ type, listener, options: settings }); original.call(document, type, listener, settings); }
  }) as typeof document.addEventListener;
  let gantt: Gantt;
  try { gantt = new Gantt(element, tasks, options); }
  catch (error) { for (const entry of listeners) document.removeEventListener(entry.type, entry.listener, entry.options); throw error; }
  finally { document.addEventListener = original; }
  return { gantt, dispose: () => { for (const entry of listeners) document.removeEventListener(entry.type, entry.listener, entry.options); gantt.clear(); element.replaceChildren(); } };
}
