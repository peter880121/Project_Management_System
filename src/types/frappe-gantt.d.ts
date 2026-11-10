declare module "frappe-gantt" {
  export type GanttTask = { id: string; name: string; start: string; end: string; progress: number; dependencies: string[]; custom_class?: string };
  export type GanttOptions = { view_mode: "Day" | "Week" | "Month"; view_modes: string[]; readonly_dates: boolean; readonly_progress: boolean; move_dependencies: boolean; snap_at?: string; popup: false; container_height: number; bar_height: number; padding: number; upper_header_height: number; lower_header_height: number; today_button: boolean; view_mode_select: boolean; infinite_padding: boolean; scroll_to: string; language: string; on_click: (task: GanttTask) => void; on_date_change?: (task: GanttTask, start: Date, end: Date) => void };
  export default class Gantt {
    constructor(element: HTMLElement, tasks: GanttTask[], options: GanttOptions);
    $container: HTMLElement;
    $svg: SVGSVGElement;
    refresh(tasks: GanttTask[]): void;
    change_view_mode(mode: string, maintainPosition?: boolean): void;
    update_options(options: Partial<GanttOptions>): void;
    clear(): void;
  }
}
