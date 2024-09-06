import React from "react";
import Video from "./Video";
import Chat from "@/components/Chat";

const ConsumerPage = () => {
  return (
    <div className="flex">
      <Video className="w-1/2 inline" />
      <Chat className="w-1/2 inline" />
    </div>
  );
};

export default ConsumerPage;
