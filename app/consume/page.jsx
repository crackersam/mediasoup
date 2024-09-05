"use client";

import { useEffect, useState, useRef } from "react";
import { socket } from "@/socket";
import * as mediasoupClient from "mediasoup-client";

export default function Home() {
  const localStream = useRef();
  const remoteVideo = useRef();
  const remoteAudio = useRef();
  const [params, setParams] = useState({
    // mediasoup params
    encodings: [
      {
        rid: "r0",
        maxBitrate: 100000,
        scalabilityMode: "S3T3",
      },
      {
        rid: "r1",
        maxBitrate: 300000,
        scalabilityMode: "S3T3",
      },
      {
        rid: "r2",
        maxBitrate: 900000,
        scalabilityMode: "S3T3",
      },
    ],
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
    codecOptions: {
      videoGoogleStartBitrate: 1000,
    },
  });
  const [device, setDevice] = useState(null);
  const [rtpCapabilities, setRtpCapabilities] = useState(null);
  const [consumerTransport, setConsumerTransport] = useState(null);
  const [consumer, setConsumer] = useState(null);
  const [audioConsumer, setAudioConsumer] = useState(null);
  const runOnce = useRef(false);

  useEffect(() => {
    if (runOnce.current) return;
    socket.on("connection-success", ({ socketId, existsProducer }) => {
      console.log(`socket id: ${socketId} connected... ${existsProducer}`);
    });
    goConsume();
    runOnce.current = true;
  }, []);

  const goConsume = () => {
    !device ? getRtpCapabilities() : createRecvTransport();
  };

  const createDevice = async () => {
    setDevice(new mediasoupClient.Device());
  };
  useEffect(() => {
    const loadDevice = async () => {
      try {
        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-load
        // Loads the device with RTP capabilities of the Router (server side)
        await device.load({
          // see getRtpCapabilities() below
          routerRtpCapabilities: rtpCapabilities,
        });

        console.log("RTP Capabilities", device.rtpCapabilities);

        goConsume();
      } catch (error) {
        console.log(error);
        if (error.name === "UnsupportedError")
          console.warn("browser not supported");
      }
    };
    if (device) {
      loadDevice();
    }
  }, [device]);

  const getRtpCapabilities = () => {
    // make a request to the server for Router RTP Capabilities
    // see server's socket.on('getRtpCapabilities', ...)
    // the server sends back data object which contains rtpCapabilities
    socket.emit("createRoom", (data) => {
      console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`);

      // we assign to local variable and will be used when
      // loading the client Device (see createDevice above)
      setRtpCapabilities(data.rtpCapabilities);

      createDevice();
    });
  };

  const createRecvTransport = async () => {
    // see server's socket.on('consume', sender?, ...)
    // this is a call from Consumer, so sender = false
    await socket.emit(
      "createWebRtcTransport",
      { sender: false },
      ({ params }) => {
        // The server sends back params needed
        // to create Send Transport on the client side
        if (params.error) {
          console.log(params.error);
          return;
        }

        console.log(params);

        // creates a new WebRTC Transport to receive media
        // based on server's consumer transport params
        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-createRecvTransport
        setConsumerTransport(device.createRecvTransport(params));
      }
    );
  };

  useEffect(() => {
    if (!consumerTransport) return;
    // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
    // this event is raised when a first call to transport.produce() is made
    // see connectRecvTransport() below
    consumerTransport.on(
      "connect",
      async ({ dtlsParameters }, callback, errback) => {
        try {
          // Signal local DTLS parameters to the server side transport
          // see server's socket.on('transport-recv-connect', ...)
          await socket.emit("transport-recv-connect", {
            dtlsParameters,
          });

          // Tell the transport that parameters were transmitted.
          callback();
        } catch (error) {
          // Tell the transport that something was wrong
          errback(error);
        }
      }
    );
    connectRecvTransport();
  }, [consumerTransport]);

  const connectRecvTransport = async () => {
    // for consumer, we need to tell the server first
    // to create a consumer based on the rtpCapabilities and consume
    // if the router can consume, it will send back a set of params as below

    await socket.emit(
      "consume",
      {
        rtpCapabilities: device.rtpCapabilities,
      },
      async ({ params, audioParams }) => {
        if (params.error) {
          console.log("Cannot Consume");
          return;
        }

        console.log(params, audioParams);
        // then consume with the local consumer transport
        // which creates a consumer
        setConsumer(
          await consumerTransport.consume({
            id: params.id,
            producerId: params.producerId,
            kind: params.kind,
            rtpParameters: params.rtpParameters,
          })
        );
        setAudioConsumer(
          await consumerTransport.consume({
            id: audioParams.id,
            producerId: audioParams.producerId,
            kind: audioParams.kind,
            rtpParameters: audioParams.rtpParameters,
          })
        );
      }
    );
  };

  useEffect(() => {
    if (!consumer || !audioConsumer) return;
    // destructure and retrieve the video track from the producer
    const { track } = consumer;
    const { track: audioTrack } = audioConsumer;

    remoteVideo.current.srcObject = new MediaStream([track]);
    remoteAudio.current.srcObject = new MediaStream([audioTrack]);

    // the server consumer started with media paused
    // so we need to inform the server to resume
    socket.emit("consumer-resume");
  }, [consumer, audioConsumer]);

  return (
    <div>
      <video ref={remoteVideo} autoPlay />
      <audio ref={remoteAudio} autoPlay />
    </div>
  );
}
