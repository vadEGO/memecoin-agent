# Security Policy

## 🔐 Security Measures

This project implements several security measures to protect sensitive data and prevent unauthorized access:

### Environment Variables
- **No hardcoded secrets**: All API keys and secrets use environment variables
- **Template file**: `.env.example` provides a template for required variables
- **Git exclusion**: `.env` files are excluded from version control

### API Key Protection
- **Helius API Key**: Stored in `HELIUS_API_KEY` environment variable
- **Webhook Secret**: Stored in `WEBHOOK_SECRET` environment variable
- **RPC URLs**: Can be configured via `HELIUS_RPC_URL` environment variable

### Webhook Security
- **Secret Validation**: All webhook requests require valid `x-webhook-secret` header
- **Rate Limiting**: 60 requests per 10 seconds per IP address
- **Body Size Limits**: Maximum 256KB request body size
- **Input Validation**: Proper validation and sanitization of incoming data

### Database Security
- **Local Storage**: SQLite database stored locally
- **File Permissions**: Database files have appropriate permissions
- **No Remote Access**: Database not exposed to external networks

## 🚨 Reporting Security Issues

If you discover a security vulnerability, please:

1. **DO NOT** create a public GitHub issue
2. Email security concerns to: [your-email@example.com]
3. Include detailed information about the vulnerability
4. Allow reasonable time for response before public disclosure

## 🛡️ Security Best Practices

### For Users
1. **Use strong secrets**: Generate random, complex webhook secrets
2. **Rotate API keys**: Regularly update your Helius API key
3. **Monitor access**: Check logs for suspicious activity
4. **Use HTTPS**: Always use secure connections in production
5. **Keep dependencies updated**: Regularly update npm packages

### For Developers
1. **Never commit secrets**: Always use environment variables
2. **Validate input**: Sanitize all user input
3. **Use HTTPS**: Secure all external communications
4. **Implement logging**: Monitor for security events
5. **Regular audits**: Periodically review security measures

## 🔍 Security Checklist

Before deploying to production:

- [ ] All API keys stored in environment variables
- [ ] Strong webhook secret configured
- [ ] Rate limiting enabled
- [ ] HTTPS enabled for external access
- [ ] Database files properly secured
- [ ] Logging configured for security events
- [ ] Dependencies updated to latest versions
- [ ] Security headers configured (if using reverse proxy)

## 📋 Environment Variables

Required environment variables:

```bash
# Helius API Configuration
HELIUS_API_KEY=your_helius_api_key_here
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your_key

# Webhook Configuration
WEBHOOK_SECRET=your-secret-key-here
PORT=3000
```

## 🔒 File Permissions

Ensure proper file permissions:

```bash
# Database files should be readable/writable by application only
chmod 600 db/agent.db*

# Environment files should be readable by owner only
chmod 600 .env

# Application files should be readable by owner, readable by group
chmod 644 *.js
chmod 755 *.js  # for executable scripts
```

## 🚫 What NOT to Do

- ❌ Never commit `.env` files
- ❌ Never hardcode API keys in source code
- ❌ Never use weak or default secrets
- ❌ Never expose database files to external networks
- ❌ Never log sensitive information
- ❌ Never use HTTP in production

## 📞 Contact

For security-related questions or concerns, please contact:
- Email: [your-email@example.com]
- GitHub: [your-github-username]

---

**Remember: Security is everyone's responsibility! 🔐**
