## What is it?

This is a simple API to manage deployments and releases of web games.


## Deployment Setup

Deployment is done with [PM2](https://pm2.keymetrics.io/docs/usage/deployment/).

You will need to install Bun and PM2 on the host machine. Refer to `package.json` for the Bun version used in the project.

Also, you will need to add SSH keys to host machine so it will be able to clone git repo with the project.

After that, you must run the following command to prepare the deployment:
```sh
pm2 deploy ecosystem.config.js production setup
```

Then you can deploy the app with the following command:
```sh
pm2 deploy ecosystem.config.js production
```


## Server Setup

You will need to set up a reverse proxy with your server software to forward requests to the port where the app is running.

I use Caddy as a web server, here is the section of my Caddyfile (by default it is located at `/etc/caddy/Caddyfile`):

```
your-domain.com {
	# Set this path to your site's directory.
	root * /var/www/html

	# ...more settings...

	# path relative to the root
	handle_path /papa-cherry-2/releases* {
		# notice that we have to specify the port here, use the same port as in the Bun server config
		reverse_proxy localhost:4000
	}
}
```
