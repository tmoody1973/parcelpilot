import { SignIn } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <main style={{ display: "flex", justifyContent: "center", padding: "2rem" }}>
      <SignIn />
    </main>
  );
}
