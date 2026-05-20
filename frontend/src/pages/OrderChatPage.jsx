/**
 * OrderChatPage
 * Real-time support chat has been replaced with the built-in Video Meet feature.
 * This stub keeps the route alive so existing bookmarks don't 404.
 */
import { Link } from "react-router";
import { VideoIcon, MailIcon } from "lucide-react";

function OrderChatPage() {
  return (
    <div className="space-y-4 text-left">
      <div className="card border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body gap-4">
          <h3 className="card-title text-base">Need help with this order?</h3>
          <p className="text-sm text-base-content/70">
            Our support team is ready to assist. Reach us via video call or email.
          </p>

          <div className="flex flex-wrap gap-3">
            <Link to="/meet" className="btn btn-primary gap-2">
              <VideoIcon className="size-4" aria-hidden />
              Start a Video Meeting
            </Link>

            <a
              href="mailto:support@northwind.store"
              className="btn btn-ghost gap-2 border border-base-300"
            >
              <MailIcon className="size-4" aria-hidden />
              Email support
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default OrderChatPage;
