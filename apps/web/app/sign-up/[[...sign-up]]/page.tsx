import { SignUp } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

export default function SignUpPage() {
  return (
    <main style={{ display: "flex", justifyContent: "center", padding: "2rem" }}>
      <SignUp />
    </main>
  );
}
