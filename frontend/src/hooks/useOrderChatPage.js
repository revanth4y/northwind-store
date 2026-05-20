/**
 * useOrderChatPage
 * Stream Chat SDK removed. This hook now only exposes the `paid` context
 * so OrderChatPage can conditionally render without breaking the outlet.
 */
import { useOutletContext } from "react-router";

export function useOrderChatPage() {
  const { paid } = useOutletContext();
  return { paid };
}
