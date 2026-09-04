import { useState } from "react";
import { ServerError } from "@/components/auth/ServerError";

interface DeleteAccountFormProps {
  userEmail: string;
}

export function DeleteAccountForm({ userEmail }: DeleteAccountFormProps) {
  const [inputEmail, setInputEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = inputEmail.trim() === userEmail;

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!canDelete) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inputEmail }),
      });

      if (res.redirected) {
        window.location.href = res.url;
        return;
      }

      if (!res.ok) {
        let message = "Something went wrong. Please try again.";
        try {
          const data: { error?: string } = (await res.json()) as { error?: string };
          if (data.error) message = data.error;
        } catch {
          // use default message
        }
        setError(message);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-red-500/20 bg-red-900/10 p-6">
      <h2 className="mb-1 text-base font-semibold text-red-300">Danger Zone</h2>
      <p className="mb-5 text-sm text-red-200/70">
        This action is permanent. Your data will be retained for 30 days and then permanently deleted. You will be
        signed out immediately and will not be able to sign back in.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirm-email" className="text-sm text-white/60">
            Type your email address to confirm
          </label>
          <input
            id="confirm-email"
            type="email"
            value={inputEmail}
            onChange={(e) => {
              setInputEmail(e.target.value);
            }}
            placeholder={userEmail}
            autoComplete="off"
            disabled={isLoading}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/20 transition-colors outline-none focus:border-red-400/50 disabled:opacity-50"
          />
        </div>

        <ServerError message={error} />

        <button
          type="submit"
          disabled={!canDelete || isLoading}
          className="w-full rounded-lg border border-red-500/40 bg-red-900/40 px-4 py-2.5 text-sm font-medium text-red-200 transition-colors hover:border-red-400/60 hover:bg-red-900/60 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isLoading ? "Deleting…" : "Delete my account"}
        </button>
      </form>
    </div>
  );
}
