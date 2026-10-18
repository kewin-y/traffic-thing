"use client";
import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAppForm } from "@/hooks/use-app-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ProjectAutosave } from "@/features/projects/lib/project-autosave";
import {
  defaultSimulationSettings,
  simulationSettingsSchema,
} from "../../../../shared/simulations";

const integerText = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, "Enter a whole number.")
    .refine(
      (value) => Number(value) >= min && Number(value) <= max,
      `Use a number from ${min} to ${max}.`,
    );
const formSchema = z.object({
  durationSeconds: integerText(1, 3600),
  seed: integerText(0, 2147483647),
  record: z.boolean(),
});
export function SimulateDialog({
  projectId,
  autosave,
  saved,
  hasNetwork,
  active,
}: {
  projectId: Id<"projects">;
  autosave: ProjectAutosave;
  saved: boolean;
  hasNetwork: boolean;
  active: boolean;
}) {
  const config = useQuery(api.simulations.queries.configuration);
  const start = useMutation(api.simulations.mutations.start);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef<string | null>(null);
  const form = useAppForm({
    defaultValues: {
      durationSeconds: String(defaultSimulationSettings.durationSeconds),
      seed: String(defaultSimulationSettings.seed),
      record: false,
    },
    validators: { onChange: formSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      if (autosave.getStatus() !== "saved" || autosave.isDirty()) {
        setError("Wait for your map changes to save.");
        return;
      }
      token.current ??= crypto.randomUUID();
      try {
        await start({
          projectId,
          requestId: token.current,
          expectedRevision: autosave.getRevision(),
          settings: simulationSettingsSchema.parse({
            ...value,
            durationSeconds: Number(value.durationSeconds),
            seed: Number(value.seed),
          }),
        });
        setOpen(false);
      } catch (err) {
        setError(
          err instanceof ConvexError && typeof err.data === "string"
            ? err.data
            : "Couldn’t queue this simulation. Please try again.",
        );
      }
    },
  });
  const reason = !hasNetwork
    ? "This project has no published simulation network."
    : !saved
      ? "Wait for map changes to save."
      : active
        ? "A simulation is already active."
        : config?.message;
  return (
    <div className="flex flex-col items-end gap-1">
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
        <DialogTrigger
          render={
            <Button
              disabled={!saved || !hasNetwork || active || !config?.ready}
            />
          }
        >
          Simulate
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Run baseline simulation</DialogTitle>
          <DialogDescription>
            Uses the published road network and synthetic traffic demand. Your
            map edits are saved in the run snapshot; they are not applied to
            this simulation.
          </DialogDescription>
          <form.AppForm>
            <form
              noValidate
              className="mt-5 space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!form.state.isSubmitting) await form.handleSubmit();
              }}
            >
              <form.AppField name="durationSeconds">
                {(field) => (
                  <field.TextField
                    label="Duration (seconds)"
                    type="number"
                    description="1–3600 seconds of simulation time."
                    required
                  />
                )}
              </form.AppField>
              <form.AppField name="seed">
                {(field) => (
                  <field.TextField
                    label="Random seed"
                    type="number"
                    description="Use the same seed to reproduce a run."
                    required
                  />
                )}
              </form.AppField>
              <form.AppField name="record">
                {(field) => (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.checked)
                      }
                    />
                    Save recording for later playback
                  </label>
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
                label="Start simulation"
                pendingLabel="Queueing…"
              />
            </form>
          </form.AppForm>
        </DialogContent>
      </Dialog>
      {reason && (
        <p className="max-w-xs text-right text-xs text-muted-foreground">
          {reason}
        </p>
      )}
    </div>
  );
}
