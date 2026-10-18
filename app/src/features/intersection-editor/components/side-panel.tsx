"use client";
import { PlanningChat, type PlanningChatProps } from "./planning-chat";
import { TabbedPanel } from "./tabbed-panel";
export { PANEL_DEFAULT_WIDTH } from "./tabbed-panel";
export type PanelTab = "tools" | "chat";
export function SidePanel({
  open,
  onOpenChange,
  tab,
  onTabChange,
  width,
  onWidthChange,
  tools,
  chat,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  width: number;
  onWidthChange: (width: number) => void;
  tools: React.ReactNode;
  chat: PlanningChatProps;
}) {
  return (
    <TabbedPanel
      side="right"
      label="Planning panel"
      open={open}
      onOpenChange={onOpenChange}
      value={tab}
      onValueChange={onTabChange}
      width={width}
      onWidthChange={onWidthChange}
      tabs={[
        {
          value: "tools",
          label: "Tools",
          content: (
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
              {tools}
            </div>
          ),
        },
        {
          value: "chat",
          label: "Chat",
          content: <PlanningChat key={chat.projectId} {...chat} />,
        },
      ]}
    />
  );
}
