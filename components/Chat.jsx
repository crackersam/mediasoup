"use client";
import React, { useRef } from "react";
import { socket } from "@/socket";

const Chat = ({ className }) => {
  const chatBox = useRef();
  const [username, setUsername] = React.useState("");
  const [messages, setMessages] = React.useState([]);
  const runOnce = useRef(false);

  React.useEffect(() => {
    if (runOnce.current) return;
    setUsername(prompt("Enter your name"));
    socket.on("message", (message) => {
      setMessages((prev) => [...prev, message]);
    });
    runOnce.current = true;
  }, []);

  const sendMessage = (e) => {
    e.preventDefault();
    const message = e.target.message.value;
    socket.emit("message", { message, username });
    e.target.message.value = "";
  };
  return (
    <div className={` ${className} flex flex-col`}>
      <div ref={chatBox} className="w-full h-full bg-blue-200">
        {messages.map((message, i) => (
          <p key={i} className="text-black">
            {message}
          </p>
        ))}
      </div>
      <form onSubmit={sendMessage} className="flex">
        <input
          type="text"
          name="message"
          className="bg-white text-black border w-full p-2"
        />
        <button type="submit">Submit</button>
      </form>
    </div>
  );
};

export default Chat;
