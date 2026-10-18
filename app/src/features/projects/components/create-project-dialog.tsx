"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { useAppForm } from "@/hooks/use-app-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  projectDetailsSchema,
  type ProjectState,
} from "../../../../shared/projects";

export function CreateProjectDialog({
  initialState,
  onCreated,
  label = "New project",
}: {
  initialState?: ProjectState;
  onCreated?: () => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef<string | null>(null);
  const create = useMutation(api.projects.mutations.create);
  const router = useRouter();
  const form = useAppForm({
    defaultValues: {
      name: initialState ? "My imported map" : "",
      description: "",
    },
    validators: { onChange: projectDetailsSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      token.current ??= crypto.randomUUID().replaceAll("-", "");
      try {
        const project = await create({
          ...value,
          token: token.current,
          ...(initialState ? { initialState } : {}),
        });
        onCreated?.();
        setOpen(false);
        router.push(`/project/${project.slug}`);
      } catch (err) {
        setError(
          err instanceof ConvexError && typeof err.data === "string"
            ? err.data
            : "Couldn’t create the project. Please try again.",
        );
      }
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (form.state.isSubmitting) return;
        setOpen(next);
        if (next) {
          form.reset();
          setError(null);
          token.current = null;
        }
      }}
    >
      <DialogTrigger render={<Button />}>{label}</DialogTrigger>
      <DialogContent>
        <DialogTitle>
          {initialState ? "Import your map" : "Create a project"}
        </DialogTitle>
        <DialogDescription>
          {initialState
            ? "Save this browser’s existing map as a project in your account."
            : "Give your map a name. Your edits will save automatically."}
        </DialogDescription>
        <form.AppForm>
          <form
            noValidate
            className="mt-6 space-y-5"
            onSubmit={async (event) => {
              event.preventDefault();
              if (form.state.isSubmitting) return;
              const element = event.currentTarget;
              await form.handleSubmit();
              requestAnimationFrame(() =>
                element
                  .querySelector<HTMLInputElement>('input[aria-invalid="true"]')
                  ?.focus(),
              );
            }}
          >
            <form.AppField name="name">
              {(field) => (
                <field.TextField
                  label="Project name"
                  placeholder="College Street redesign"
                  required
                />
              )}
            </form.AppField>
            <form.AppField name="description">
              {(field) => (
                <field.TextField
                  label="Description (optional)"
                  placeholder="What are you exploring?"
                />
              )}
            </form.AppField>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(pending) => (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={pending}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
              )}
            </form.Subscribe>
            <form.SubmitButton
              label={initialState ? "Import project" : "Create project"}
              pendingLabel="Creating project…"
            />
          </form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}
