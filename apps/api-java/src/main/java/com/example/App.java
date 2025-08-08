package com.example;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;

public class App {
    public static void main(String[] args) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(8081), 0);
        server.createContext("/", new RootHandler());
        server.setExecutor(null);
        System.out.println("api-java listening on :8081");
        server.start();
    }

    static class RootHandler implements HttpHandler {
        public void handle(HttpExchange t) throws IOException {
            String response = "{\"service\":\"api-java\",\"status\":\"ok\"}";
            t.getResponseHeaders().add("Content-Type", "application/json");
            t.sendResponseHeaders(200, response.length());
            OutputStream os = t.getResponseBody();
            os.write(response.getBytes());
            os.close();
        }
    }
}

