"use client";

import { useEffect, useState, useRef } from "react";
import { socket } from "@/socket";
import * as mediasoupClient from "mediasoup-client";

export default function Home() {
  const localStream = useRef();
  const remoteVideo = useRef();
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
  const [audioParams, setAudioParams] = useState({});
  const [device, setDevice] = useState(null);
  const [rtpCapabilities, setRtpCapabilities] = useState(null);
  const [producerTransport, setProducerTransport] = useState(null);
  const [producer, setProducer] = useState(null);
  const [audioProducer, setAudioProducer] = useState(null);
  const [consumerTransport, setConsumerTransport] = useState(null);
  const [consumer, setConsumer] = useState(null);
  const isProducer = useRef(false);
  const runOnce = useRef(false);

  useEffect(() => {
    if (runOnce.current) return;
    socket.on("connection-success", ({ socketId, existsProducer }) => {
      console.log(`socket id: ${socketId} connected... ${existsProducer}`);
    });
    getLocalStream();
    runOnce.current = true;
  }, []);

  const goConnect = () => {
    !device ? getRtpCapabilities() : createSendTransport();
  };

  const getLocalStream = async () => {
    try {
      navigator.mediaDevices
        .getUserMedia({ video: true, audio: true })
        .then((stream) => {
          localStream.current.srcObject = stream;
          const track = stream.getVideoTracks()[0];
          const audioTrack = stream.getAudioTracks()[0];
          setParams((prev) => ({ ...prev, track }));
          setAudioParams((prev) => ({ ...prev, track: audioTrack }));
          goConnect(true);
        });
    } catch (error) {
      console.log(`Error accessing media devices: ${error}`);
    }
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

        goConnect();
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

  const createSendTransport = () => {
    // see server's socket.on('createWebRtcTransport', sender?, ...)
    // this is a call from Producer, so sender = true
    socket.emit("createWebRtcTransport", { sender: true }, ({ params }) => {
      // The server sends back params needed
      // to create Send Transport on the client side
      if (params.error) {
        console.log(params.error);
        return;
      }

      console.log(params);

      // creates a new WebRTC Transport to send media
      // based on the server's producer transport params
      // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
      setProducerTransport(device.createSendTransport(params));
    });
  };

  useEffect(() => {
    if (!producerTransport) return;
    // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
    // this event is raised when a first call to transport.produce() is made
    // see connectSendTransport() below
    producerTransport.on(
      "connect",
      async ({ dtlsParameters }, callback, errback) => {
        try {
          // Signal local DTLS parameters to the server side transport
          // see server's socket.on('transport-connect', ...)
          await socket.emit("transport-connect", {
            dtlsParameters,
          });

          // Tell the transport that parameters were transmitted.
          callback();
        } catch (error) {
          errback(error);
        }
      }
    );

    producerTransport.on("produce", async (parameters, callback, errback) => {
      console.log(parameters);

      try {
        // tell the server to create a Producer
        // with the following parameters and produce
        // and expect back a server side producer id
        // see server's socket.on('transport-produce', ...)
        await socket.emit(
          "transport-produce",
          {
            kind: parameters.kind,
            rtpParameters: parameters.rtpParameters,
            appData: parameters.appData,
          },
          ({ id }) => {
            // Tell the transport that parameters were transmitted and provide it with the
            // server side producer's id.
            callback({ id });
          }
        );
      } catch (error) {
        errback(error);
      }
    });
    connectSendTransport();
  }, [producerTransport]);

  const connectSendTransport = async () => {
    // we now call produce() to instruct the producer transport
    // to send media to the Router
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
    // this action will trigger the 'connect' and 'produce' events above
    setProducer(await producerTransport.produce(params));
    setAudioProducer(await producerTransport.produce(audioParams));
  };

  useEffect(() => {
    if (!producer || !audioProducer) return;
    producer.on("trackended", () => {
      console.log("track ended");

      // close video track
    });

    producer.on("transportclose", () => {
      console.log("transport ended");

      // close video track
    });
    audioProducer.on("trackended", () => {
      console.log("track ended");

      // close audio track
    });

    audioProducer.on("transportclose", () => {
      console.log("transport ended");

      // close audio track
    });
  }, [producer, audioProducer]);

  return (
    <div>
      <video ref={localStream} autoPlay controls />{" "}
    </div>
  );
}
