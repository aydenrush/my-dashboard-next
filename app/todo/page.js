import { redirect } from "next/navigation";

// To Do was merged into Brain Dump (notes tagged "To Do"); keep old links working
export default function TodoPage() {
  redirect("/brain-dump");
}
