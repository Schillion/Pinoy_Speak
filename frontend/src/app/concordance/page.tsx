import { redirect } from "next/navigation";

export default function ConcordanceRedirect() {
  redirect("/translator?tab=concordance");
}
