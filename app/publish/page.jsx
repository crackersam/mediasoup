import React from "react";
import Video from "./Video";
import Chat from "@/components/Chat";

const PublishPage = () => {
  return (
    <div className="flex">
      <Video className="w-1/2" />
      <Chat className="w-1/2" />
    </div>
  );
};

export default PublishPage;
