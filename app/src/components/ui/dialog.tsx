"use client";

import { Dialog as Primitive } from "@base-ui/react/dialog";
import { cn } from "cn";

export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;
export function DialogContent({
  className,
  children,
  ...props
}: Primitive.Popup.Props) {
  return (
    <Primitive.Portal>
      <Primitive.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
      <Primitive.Popup
        {...props}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 max-h-[90svh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-background p-6 text-foreground shadow-xl outline-none",
          className,
        )}
      >
        {children}
      </Primitive.Popup>
    </Primitive.Portal>
  );
}
export function DialogTitle(props: Primitive.Title.Props) {
  return (
    <Primitive.Title
      {...props}
      className={cn("text-lg font-semibold", props.className)}
    />
  );
}
export function DialogDescription(props: Primitive.Description.Props) {
  return (
    <Primitive.Description
      {...props}
      className={cn("mt-2 text-sm text-muted-foreground", props.className)}
    />
  );
}
