# Hypha Spike: Multiwriter 2

[Blog post](https://ar.al/2019/02/01/hypha-spike-multiwriter-2/)

## Usage

1. Create keys using [mkcert](https://github.com/FiloSottile/mkcert) in the _/server_ directory:

    ```bash
    # If you haven’t used mkcert before, you must first create
    # and install your local Certificate Authority (CA):
    mkcert -install

    # Generate your keys for localhost:
    mkcert localhost
    ```

    This will create the `localhost.pem` and `localhost-key.pem` files used by the server to create a TLS connection.

    (Note: for the certificate to be accepted without warning, you must restart your browser after running `mkcert -install`.)

2. Give Node.js permission to bind to ports < 1024 (i.e., 80 and 443) without being root:

    ### Linux

    ```bash
    sudo setcap 'cap_net_bind_service=+ep' $(which node)
    ```

    ### macOS

    [Setup authbind on macOS](https://medium.com/@steve.mu.dev/setup-authbind-on-mac-os-6aee72cb828) and, in addition to the instructions in the link-to post, also setup port 444 in addition to ports 443 and 80 as shown there. (Note: Port 80 is not required for this app.)

3. Run the app:

    ### Linux

    ```bash
    npm start
    ```

    ### macOS

    ```bash
    authbind node server/index.js
    ```
