import { signIn, signOut } from "@/auth";

export function SignInButton({ label = "Continue with GitHub" }: { label?: string }) {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("github", { redirectTo: "/dashboard" });
      }}
    >
      <button
        type="submit"
        className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-neutral-950 transition hover:bg-neutral-200"
      >
        <svg viewBox="0 0 16 16" aria-hidden className="size-4 fill-current">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-2.91-.88-2.91-2.9 0-.58.21-1.06.55-1.43-.05-.14-.24-.69.05-1.44 0 0 .57-.18 1.87.69a5.3 5.3 0 0 1 1.4-.19c.48 0 .96.06 1.4.19 1.3-.88 1.87-.69 1.87-.69.29.75.1 1.3.05 1.44.34.37.55.85.55 1.43 0 2.03-1.14 2.7-2.92 2.9.3.26.56.76.56 1.54 0 1.11-.01 2-.01 2.27 0 .21.15.46.55.38A7.99 7.99 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>
        {label}
      </button>
    </form>
  );
}

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <button
        type="submit"
        className="text-sm text-neutral-400 transition hover:text-white"
      >
        Sign out
      </button>
    </form>
  );
}
