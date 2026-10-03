FROM golang:1.23 AS build
WORKDIR /src
COPY services/api/ .
RUN CGO_ENABLED=0 go build -o /app/server .

FROM gcr.io/distroless/static-debian12
COPY --from=build /app/server /app/server
EXPOSE 8080
ENTRYPOINT ["/app/server"]
